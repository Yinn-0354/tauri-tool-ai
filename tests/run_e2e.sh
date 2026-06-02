#!/bin/bash
# Tauri Tool AI E2E 验收测试脚本
# 用法: bash tests/run_e2e.sh

set -e
cd "$(dirname "$0")/.."

echo "=== 构建前端 ==="
npx vite build

echo "=== 编译 Rust ==="
cd src-tauri
cargo build --release
cd ..

echo "=== 复制 Python 后端到 release ==="
mkdir -p src-tauri/target/release/python-backend/readers
cp python-backend/main.py src-tauri/target/release/python-backend/
cp python-backend/readers/__init__.py src-tauri/target/release/python-backend/readers/
cp python-backend/readers/excel.py src-tauri/target/release/python-backend/readers/
cp python-backend/readers/csv.py src-tauri/target/release/python-backend/readers/

echo "=== 复制 dist 到 Tauri 位置 ==="
mkdir -p src-tauri/target/dist
cp -r dist/* src-tauri/target/dist/

echo "=== 运行 E2E 测试 ==="
APP_PATH="$(pwd)/src-tauri/target/release/tauri-tool-ai.exe" \
APP_TITLE="Tauri Tool AI" \
pytest tests/ -v --html=tests/artifacts/report.html --self-contained-html

echo "=== 验收完成 ==="
echo "测试报告: tests/artifacts/report.html"
