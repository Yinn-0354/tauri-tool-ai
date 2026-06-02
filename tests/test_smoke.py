"""Phase 3 冒烟测试 — Tauri Tool AI"""

import time
import pytest


class TestAppLaunch:
    """应用启动基本验证"""

    def test_window_visible(self, app):
        """窗口应可见且有正确标题"""
        assert app.is_visible(), "窗口不可见"
        title = app.window_text()
        assert "Tauri Tool AI" in title, f"标题不匹配: {title}"

    def test_window_size(self, app):
        """窗口尺寸应 >= 1400×900"""
        rect = app.rectangle()
        w, h = rect.width(), rect.height()
        assert w >= 1400, f"宽度不足: {w}"
        assert h >= 900, f"高度不足: {h}"

    def test_window_not_minimized(self, app):
        """窗口不应最小化"""
        assert not app.is_minimized(), "窗口处于最小化状态"

    def test_window_enabled(self, app):
        """窗口应处于可用状态"""
        assert app.is_enabled(), "窗口被禁用"


class TestStability:
    """应用稳定性验证"""

    def test_app_not_crashed_after_wait(self, app):
        """启动后等待 5 秒，窗口仍可见（未崩溃）"""
        time.sleep(5)
        assert app.is_visible(), "应用启动后崩溃或关闭"
        assert app.is_enabled(), "应用启动后被禁用"

    def test_screenshot(self, app):
        """截取验收截图"""
        import os
        from config import ARTIFACT_DIR
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        path = os.path.join(ARTIFACT_DIR, "acceptance_screenshot.png")
        app.capture_as_image().save(path)
        assert os.path.exists(path), "截图保存失败"
        print(f"验收截图: {path}")


class TestBackend:
    """Python 后端验证"""

    def test_backend_port_file(self, app):
        """端口文件应存在且包含有效端口"""
        import os
        import tempfile
        port_file = os.path.join(tempfile.gettempdir(), "tauri-tool-ai-port.txt")
        # 等待端口文件生成
        deadline = time.time() + 15
        while time.time() < deadline:
            if os.path.exists(port_file):
                break
            time.sleep(0.5)
        assert os.path.exists(port_file), f"端口文件不存在: {port_file}"
        port = int(open(port_file).read().strip())
        assert 1024 < port < 65535, f"无效端口号: {port}"
        print(f"Python 后端端口: {port}")

    def test_backend_health(self, app):
        """后端 /health 端点应返回 200"""
        import os
        import tempfile
        import urllib.request
        port_file = os.path.join(tempfile.gettempdir(), "tauri-tool-ai-port.txt")
        deadline = time.time() + 15
        while time.time() < deadline:
            if os.path.exists(port_file):
                break
            time.sleep(0.5)
        if not os.path.exists(port_file):
            pytest.skip("端口文件未生成，后端可能未启动")
        port = open(port_file).read().strip()
        try:
            resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5)
            assert resp.status == 200
        except Exception as e:
            pytest.fail(f"后端 /health 不可达: {e}")
