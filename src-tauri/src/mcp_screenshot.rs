/// 截图 MCP server:axum HTTP server 常驻 Tauri 内(PRD §4.4)。
///
/// Claude Agent(Python sidecar) 审核时需现场开表/冻结/滚动/截图,但这些操作
/// 必须在能发 Tauri event 的进程里做——所以 Rust 起 HTTP MCP endpoint,Python 经
/// `McpHttpServerConfig` 连过来,收到工具调用后 emit Tauri event 给前端隐藏 AG Grid
/// 执行,前端执行完 emit 回来,oneshot 等结果回给 MCP caller。
///
/// 跨进程:axum server → Tauri event(screenshot-mcp:request)→ 前端 →
///         screenshot-mcp:response → oneshot → MCP result
///
/// 端口发现:随机端口 → 写 %TEMP%/tauri-tool-ai-mcp-port.txt,Python 读端口连
/// (复用现有 sidecar 端口发现机制,PRD §4.4)。
///
/// 7 工具(PRD §4.3-A):
///   open_table, get_columns, search_cell, freeze_column, goto_cell,
///   get_viewport_info, screenshot
///
/// MCP JSON-RPC 协议:POST /mcp,req={jsonrpc,method,params,id}
use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::Arc;

use axum::{
    extract::State as AxumState,
    response::Json,
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Listener};
use tokio::sync::{oneshot, Mutex};

// ───────────────────────── MCP JSON-RPC 类型 ─────────────────────────

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

// ───────────────────────── 工具调用 → Tauri event 往返 ─────────────────────────

/// 发给前端的请求载荷(event screenshot-mcp:request)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct McpEventRequest {
    request_id: String,
    tool: String,
    args: Value,
}

/// 前端回传的响应载荷(event screenshot-mcp:response)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct McpEventResponse {
    request_id: String,
    #[serde(default)]
    result: Value,
    #[serde(default)]
    error: Option<String>,
}

/// 等待中的请求映射(request_id → oneshot sender)。
pub type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<McpEventResponse>>>>;

// ───────────────────────── MCP 工具定义 ─────────────────────────

#[derive(Clone)]
struct ToolDef {
    name: &'static str,
    description: &'static str,
    input_schema: Value,
}

fn tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "open_table",
            description: "在工作区打开指定配置表(解析绝对路径,落 Parquet 缓存),返回 columns/rowCount/idColCandidates。入参 table_path 可以是纯文件名或相对路径,内部按 appkey→根映射解析。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "table_path": {"type": "string", "description": "配置表名,可能纯文件名或带相对路径"}
                },
                "required": ["table_path"]
            }),
        },
        ToolDef {
            name: "get_columns",
            description: "取当前已打开表的列名列表(用于判断 errorObj 的 name 字段是否在表中、找 ID 列)。",
            input_schema: json!({"type": "object", "properties": {}, "required": []}),
        },
        ToolDef {
            name: "search_cell",
            description: "全表搜索某值,定位行(rowID 不可信时回退用)。返回匹配列表 [{rowIndex, colIndex, colName, value}]。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "要搜索的值(子串匹配,大小写不敏感)"}
                },
                "required": ["query"]
            }),
        },
        ToolDef {
            name: "freeze_column",
            description: "冻结某列到左(同时冻结左边的所有列),使该列始终可见,截图时同时看到 ID 列与错误列。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "col_name": {"type": "string", "description": "要冻结到的列名"}
                },
                "required": ["col_name"]
            }),
        },
        ToolDef {
            name: "goto_cell",
            description: "跳到指定行并可选聚焦某列,触发 infinite 加载确保该行已渲染。返回该单元格值供校验。row_index 是 0-based 有效行序号(非源文件行)。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "row_index": {"type": "integer", "description": "行号(0-based,有效行序号)"},
                    "col_name": {"type": "string", "description": "可选:要聚焦的列名"}
                },
                "required": ["row_index"]
            }),
        },
        ToolDef {
            name: "get_viewport_info",
            description: "读当前 AG Grid 视口:可见行/列/topLeftRow/focusedCell 及各可见单元格的值,用于核验截图信息齐全(ID列+错误行+错误列同时可见)。",
            input_schema: json!({"type": "object", "properties": {}, "required": []}),
        },
        ToolDef {
            name: "screenshot",
            description: "html2canvas 截当前 AG Grid 根 div 为 PNG(base64),返回 {imageBase64}。截图前应已 freeze_column+goto_cell 并核验齐全。",
            input_schema: json!({"type": "object", "properties": {}, "required": []}),
        },
    ]
}

// ───────────────────────── Server 共享状态 ─────────────────────────

struct AppState {
    app: AppHandle,
    pending: PendingMap,
}

// ───────────────────────── MCP 请求路由 ─────────────────────────

async fn mcp_handler(
    AxumState(state): AxumState<Arc<AppState>>,
    Json(req): Json<Value>,
) -> Json<Value> {
    let rpc: JsonRpcRequest = match serde_json::from_value(req) {
        Ok(r) => r,
        Err(e) => {
            return Json(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": format!("Parse error: {e}")}}));
        }
    };
    let req_id = rpc.id.clone().unwrap_or(Value::Null);

    let resp = match rpc.method.as_str() {
        "initialize" => handle_initialize(rpc.params),
        "notifications/initialized" => {
            // JSON-RPC 2.0:通知无 id,服务器不应回复;直接 return null
            return Json(json!({"jsonrpc": "2.0"}));
        }
        "tools/list" => handle_tools_list(),
        "tools/call" => handle_tools_call(state, rpc.params).await,
        _ => Err(JsonRpcError {
            code: -32601,
            message: format!("Method not found: {}", rpc.method),
        }),
    };

    match resp {
        Ok(result) => Json(json!({"jsonrpc": "2.0", "id": req_id, "result": result})),
        Err(err) => Json(json!({"jsonrpc": "2.0", "id": req_id, "error": err})),
    }
}

fn handle_initialize(_params: Option<Value>) -> Result<Value, JsonRpcError> {
    Ok(json!({
        "protocolVersion": "2024-11-05",
        "serverInfo": {"name": "screenshot-mcp", "version": "0.1.0"},
        "capabilities": {"tools": {}}
    }))
}

fn handle_tools_list() -> Result<Value, JsonRpcError> {
    let tools: Vec<Value> = tools()
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": t.input_schema,
            })
        })
        .collect();
    Ok(json!({"tools": tools}))
}

async fn handle_tools_call(
    state: Arc<AppState>,
    params: Option<Value>,
) -> Result<Value, JsonRpcError> {
    let p = params.ok_or(JsonRpcError {
        code: -32602,
        message: "Missing params".into(),
    })?;
    let tool_name = p["name"].as_str().unwrap_or("").to_string();
    let args = p.get("arguments").cloned().unwrap_or(Value::Null);

    let request_id = uuid_v4();
    let (tx, rx) = oneshot::channel();

    {
        let mut map = state.pending.lock().await;
        map.insert(request_id.clone(), tx);
    }

    let evt = McpEventRequest {
        request_id: request_id.clone(),
        tool: tool_name.clone(),
        args,
    };
    let _ = state.app.emit("screenshot-mcp:request", &evt);

    let result = match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(resp)) => {
            if let Some(err) = &resp.error {
                Err(JsonRpcError {
                    code: -32000,
                    message: format!("{tool_name}({err})"),
                })
            } else {
                Ok(resp.result)
            }
        }
        Ok(Err(_)) => Err(JsonRpcError {
            code: -32000,
            message: "oneshot sender dropped".into(),
        }),
        Err(_) => Err(JsonRpcError {
            code: -32000,
            message: format!("工具调用超时(30s):{tool_name}"),
        }),
    };

    {
        let mut map = state.pending.lock().await;
        map.remove(&request_id);
    }

    result.map(|r| {
        let text = serde_json::to_string(&r).unwrap_or_default();
        json!({"content": [{"type": "text", "text": text}]})
    })
}

// ───────────────────────── 前端响应接收器 ─────────────────────────

pub fn register_response_listener_pending() -> PendingMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn register_response_listener(app: &AppHandle, pending: PendingMap) {
    let _app = app.clone();
    app.listen("screenshot-mcp:response", move |event| {
        let pending = pending.clone();
        let payload: McpEventResponse = match serde_json::from_str(event.payload()) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("screenshot-mcp:response 解析失败: {e}");
                return;
            }
        };
        let id = payload.request_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut map = pending.lock().await;
            if let Some(tx) = map.remove(&id) {
                let _ = tx.send(payload);
            } else {
                log::warn!("screenshot-mcp:response 无匹配 pending: {id}");
            }
        });
        // suppress unused-app warning
        let _ = &_app;
    });
}

// ───────────────────────── 端口工具 ─────────────────────────

pub fn write_port_file(port: u16) -> std::io::Result<()> {
    let path = std::env::temp_dir().join("tauri-tool-ai-mcp-port.txt");
    std::fs::write(&path, port.to_string())
}

pub fn remove_port_file() {
    let path = std::env::temp_dir().join("tauri-tool-ai-mcp-port.txt");
    let _ = std::fs::remove_file(path);
}

// ───────────────────────── 启动 HTTP server ─────────────────────────

pub async fn start_mcp_server(
    app: AppHandle,
    pending: PendingMap,
) -> (u16, tokio::sync::oneshot::Sender<()>) {
    let listener =
        TcpListener::bind("127.0.0.1:0").expect("bind 截图 MCP server 端口失败");
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).ok();

    let state = Arc::new(AppState {
        app: app.clone(),
        pending,
    });

    let router = Router::new()
        .route("/mcp", post(mcp_handler))
        .with_state(state);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let listener = tokio::net::TcpListener::from_std(listener).unwrap();
    tauri::async_runtime::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    (port, shutdown_tx)
}

// ───────────────────────── 小工具:简单 UUID ─────────────────────────

fn uuid_v4() -> String {
    use std::sync::atomic::AtomicU64;
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let c = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{ts:016x}-{c:04x}")
}
