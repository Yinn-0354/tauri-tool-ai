"""配置检查器模块(模块2)。

后端组成:
- config.py:全局设置(环境切换 + appkey→本地根路径映射 + 脚本库根目录),%LOCALAPPDATA%/tauri-tool-ai/checker-config.json 持久化。
- rulecheck_client.py:rulecheck MCP 客户端封装,按环境调 get_all_check_results_in_report + get_rule_by_rule_id。

第一层取数:POST /api/checker/report {reportUrl, ruleName?} → rulecheck_client.fetch_report(reportUrl, ruleName)
  → MCP get_all_check_results_in_report(reportId) 拿全量规则结果 data[]
  → 后端本地按 rule_name 精确过滤(可选)
  → 每条规则补规则详情(get_rule_by_rule_id 拿 desc + script_path)
  → 返回 PRD 2.1 结构。
"""
