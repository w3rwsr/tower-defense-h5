/* ============================================================
 * build-www.js —— 生成 Capacitor Web 资源目录 www/
 *
 * 只复制游戏运行所需文件，避免把 node_modules、.git、android、
 * _video_raw、Python 构建脚本等无关内容打进 APK。
 *
 * 用法：npm run build:web（npx cap sync 前会自动执行）
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

/* 白名单：index.html 及其引用到的全部运行资源 */
const ITEMS = ['index.html', 'style.css', 'js', 'assets', 'vendor'];

function sizeOf(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce((sum, name) => sum + sizeOf(path.join(target, name)), 0);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let total = 0;
for (const item of ITEMS) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) {
    throw new Error(`缺少运行资源：${item}`);
  }
  fs.cpSync(src, path.join(OUT, item), { recursive: true });
  total += sizeOf(src);
  console.log(`  + ${item}`);
}

console.log(`www/ 已生成：${(total / 1024 / 1024).toFixed(2)} MB`);
