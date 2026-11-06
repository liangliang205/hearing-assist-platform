#!/usr/bin/env node
// 构建 Rust 音频引擎并作为 Tauri sidecar 放到 apps/desktop/src-tauri/binaries/。
//
// Tauri 要求 sidecar 文件名带目标三元组后缀，打包时会自动去掉。

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.HEARLINK_TARGET_TRIPLE ?? 'x86_64-pc-windows-msvc';

console.log('[sidecar] 构建 hearlink-audio（release）…');
execFileSync(
  'cargo',
  ['build', '--release', '--manifest-path', resolve(root, 'rust/hearlink-audio/Cargo.toml')],
  { stdio: 'inherit', cwd: root },
);

const source = resolve(root, 'rust/hearlink-audio/target/release/hearlink-audio.exe');
const outDir = resolve(root, 'apps/desktop/src-tauri/binaries');
const destination = resolve(outDir, `hearlink-audio-${target}.exe`);

mkdirSync(outDir, { recursive: true });
copyFileSync(source, destination);
console.log(`[sidecar] 已复制到 ${destination}`);
