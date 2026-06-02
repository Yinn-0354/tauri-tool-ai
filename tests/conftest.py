"""Pytest 配置 — Tauri Tool AI E2E 测试"""

import os
import time
import pytest

from pywinauto import Application
from config import APP_PATH, APP_TITLE, LAUNCH_TIMEOUT, ARTIFACT_DIR


def _find_exe():
    if APP_PATH:
        return os.path.abspath(APP_PATH)
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "src-tauri", "target", "release", "tauri-tool-ai.exe"),
        os.path.join(os.path.dirname(__file__), "..", "src-tauri", "target", "debug", "tauri-tool-ai.exe"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return os.path.abspath(p)
    return ""


@pytest.fixture(scope="function")
def app(request):
    """启动应用，返回主窗口对象。"""
    exe_path = _find_exe()
    if not exe_path:
        pytest.exit("找不到 tauri-tool-ai.exe，请设置 APP_PATH 环境变量", returncode=1)

    print(f"\n启动: {exe_path}")

    # 用 Application.start 启动，返回的 Application 对象可正确获取 WindowSpecification
    proc = Application(backend="uia").start(exe_path, timeout=LAUNCH_TIMEOUT)

    # 等待窗口出现 — 使用 WindowSpecification.wait()
    win = proc.window(title=APP_TITLE)
    try:
        win.wait("visible", timeout=LAUNCH_TIMEOUT)
    except Exception:
        # 列出当前窗口帮助调试
        print("当前所有顶层窗口:")
        from pywinauto import Desktop
        for w in Desktop(backend="uia").windows():
            print(f"  [{w.window_text()}]")
        pytest.fail(f"等待窗口 '{APP_TITLE}' 超时 ({LAUNCH_TIMEOUT}s)")

    print(f"窗口已就绪: {win.window_text()}")
    time.sleep(1)  # 等 WebView 渲染

    yield win

    # 清理
    if getattr(getattr(request.node, "rep_call", None), "failed", False):
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        try:
            win.capture_as_image().save(
                os.path.join(ARTIFACT_DIR, f"FAIL_{request.node.name}.png"),
            )
        except Exception:
            pass

    try:
        win.close()
        proc.wait_for_process_exit(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    setattr(item, f"rep_{outcome.get_result().when}", outcome.get_result())
