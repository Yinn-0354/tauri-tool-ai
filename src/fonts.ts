/**
 * 字体本地打包入口(无网络请求)。
 *
 * - UI/body 用 "IBM Plex Sans" variable(@fontsource-variable,单文件全权重)。
 * - 数据/品牌/数字用 "IBM Plex Mono" 非 variable(该家族无 variable 包,装 400/500 两权重)。
 * - CJK 中文回退系统字体("PingFang SC","Microsoft YaHei"),无需打包中文字体。
 *
 * 安装时必须用 `npm install --ignore-scripts <pkg>`(nvm4w 下 esbuild postinstall 会失败)。
 * 在 agGridSetup.ts 顶部 import 一次即可全局生效。
 */

// Plex Sans variable:单 css 含 wght 轴 100..700
import "@fontsource-variable/ibm-plex-sans";

// Plex Mono 非 variable:仅加载 400/500 两权重(数据/数字用)
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
