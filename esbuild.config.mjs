// @ts-check
import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outdir: 'dist',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
    tsconfig: 'tsconfig.json',
    logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    outdir: 'dist/webview',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    // 确保输出为自执行函数，可直接内联到 HTML
    globalName: 'workTimeWebview',
};

async function main() {
    if (watch) {
        const [extCtx, wvCtx] = await Promise.all([
            esbuild.context(extensionConfig),
            esbuild.context(webviewConfig),
        ]);
        await Promise.all([extCtx.watch(), wvCtx.watch()]);
        console.log('[esbuild] 正在监听文件变更...');
    } else {
        await Promise.all([
            esbuild.build(extensionConfig),
            esbuild.build(webviewConfig),
        ]);
        console.log('[esbuild] 构建完成');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
