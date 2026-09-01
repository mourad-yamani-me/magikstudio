#!/usr/bin/env node
/**
 * What a phone actually downloads from an Android App Bundle.
 *
 *     node delivered-size.mjs app-release.aab [density]
 *
 * `ls -l` on the .aab is not the download, and the gap is large enough to send
 * you optimising the wrong thing. Play splits a bundle per device — by screen
 * density, by ABI, by language — and strips its own metadata before delivery.
 *
 * The one that catches everybody: turning on R8 ADDS a multi-megabyte
 * BUNDLE-METADATA/.../proguard.map to the .aab. Play keeps it to deobfuscate
 * crash reports and never sends it to anyone. On one app that was 3.83 MB, so
 * the file on disk looked barely improved while the real download had halved.
 *
 * This is an estimate, not bundletool's exact figure. It moves when the real
 * one does, which is what makes a creeping regression visible — and it needs
 * nothing but unzip.
 */
import { execFileSync } from 'node:child_process';

const aab = process.argv[2];
const density = process.argv[3] ?? 'xxhdpi';

if (!aab) {
  console.error('usage: node delivered-size.mjs <bundle.aab> [density]');
  process.exit(1);
}

const others = ['ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']
  .filter((d) => d !== density);

const lines = execFileSync('unzip', ['-lv', aab], {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
}).split('\n');

let total = 0;
let kept = 0;
const buckets = {};

for (const line of lines) {
  // length  method  size  cmpr  date  time  crc-32  name
  const m = line.match(/^\s*(\d+)\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
  if (!m) continue;

  const compressed = Number(m[2]);
  const path = m[3].trim();
  total += compressed;

  // Never delivered: R8's mapping file and the signature block.
  if (path.startsWith('BUNDLE-METADATA/') || path.startsWith('META-INF/')) continue;
  // Delivered only to devices of that density.
  if (others.some((d) => path.includes(`-${d}-`) || path.includes(`-${d}/`))) continue;

  kept += compressed;
  const key = path.split('/').slice(0, 3).join('/');
  buckets[key] = (buckets[key] ?? 0) + compressed;
}

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

console.log(aab);
console.log(`  .aab on disk        ${mb(total)}`);
console.log(`  delivered (${density})  ${mb(kept)}`);

for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`      ${mb(v).padStart(8)}  ${k}`);
}

// Typical output before and after an optimisation pass:
//
//   .aab on disk        16.83 MB          .aab on disk        10.41 MB
//   delivered (xxhdpi)  13.09 MB          delivered (xxhdpi)   5.88 MB
//        3.01 MB  base/dex/classes2.dex        3.21 MB  base/dex/classes.dex
//        2.90 MB  base/dex/classes.dex         1.10 MB  base/assets/public
//        2.71 MB  base/dex/classes3.dex        1.03 MB  base/dex/classes2.dex
//        1.65 MB  base/assets/public           0.20 MB  base/resources.pb
//        0.93 MB  base/dex/classes4.dex        0.07 MB  base/res/mipmap-xxhdpi-v4
