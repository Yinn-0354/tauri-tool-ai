# 用 PyInstaller 把 python-backend 打成单 exe sidecar,放到 src-tauri/binaries/(带 target triple 后缀)。
# 供本地预打包 + GitLab CI 调用。Tauri bundle.externalBin 按 triple 找 backend-x86_64-pc-windows-msvc.exe。
#
# polars/fastexcel/python_calamine 是 Rust 扩展,--collect-all 防漏;uvicorn 子模块多,一并 collect。
# probe.py 不被 main.py import,默认不进 exe。
# Python 须 64 位匹配 Tauri target(x86_64)。
$ErrorActionPreference = "Stop"
Push-Location "$PSScriptRoot"

# 装依赖(含 pyinstaller)。CI runner 若已装可注释掉此行加速。
python -m pip install -r requirements.txt pyinstaller

# onefile 打包。--noconfirm 覆盖上次产物。
pyinstaller --onefile --name backend --noconfirm `
    --collect-all polars `
    --collect-all fastexcel `
    --collect-all python_calamine `
    --collect-all uvicorn `
    --hidden-import vcs.svn `
    main.py

# 取 Rust target triple(如 x86_64-pc-windows-msvc),重命名产物放 src-tauri/binaries/
$triple = (& rustc --print host-tuple).Trim()
if (-not $triple) { throw "无法取 rust target triple,确认 rustc 在 PATH" }
$dest = "../src-tauri/binaries"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Move-Item "dist/backend.exe" "$dest/backend-$triple.exe" -Force
Write-Host "sidecar 已生成: $dest/backend-$triple.exe"

# 往 tauri.conf.json 的 bundle 注入 resources:把 sidecar exe 作资源打进安装包(运行时 lib.rs 从 resource_dir/backend.exe 定位)。
# dev 期 tauri.conf 不含此 resources,lib.rs 找不到 sidecar 回退 python main.py → dev 零影响。
# 用正则插入避免 PowerShell JSON 往返丢格式:在 bundle 块内、"icon" 之前插入 resources 映射。
$confPath = "../src-tauri/tauri.conf.json"
$conf = Get-Content $confPath -Raw
$srcKey = "binaries/backend-$triple.exe"
if ($conf -notmatch '"resources"') {
    # 在 "icon": 之前插 resources 映射(若已有 resources 则跳过,幂等)
    $insert = "    `"resources`": { `"$srcKey`": `"backend.exe`" },`r`n"
    $conf = $conf -replace '(\s*"icon":)', "$insert`$1"
} else {
    # 已有 resources:确保 backend.exe 项存在(简化:替换整个 resources 块)
    $conf = $conf -replace '"resources"\s*:\s*\{[^}]*\}', "`"resources`": { `"$srcKey`": `"backend.exe`" }"
}
Set-Content $confPath -Value $conf -NoNewline
Write-Host "已注入 bundle.resources 到 tauri.conf.json(打包时把 sidecar 作资源)"

Pop-Location
