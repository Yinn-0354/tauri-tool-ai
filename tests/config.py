import os

# 应用路径 — 通过环境变量或自动检测
APP_PATH = os.environ.get("APP_PATH", "")
APP_TITLE = os.environ.get("APP_TITLE", "Tauri Tool AI")

# 超时配置 (秒)
LAUNCH_TIMEOUT = int(os.environ.get("LAUNCH_TIMEOUT", "20"))
ACTION_TIMEOUT = int(os.environ.get("ACTION_TIMEOUT", "10"))

# 产物目录
ARTIFACT_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
