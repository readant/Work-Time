// @ts-check
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const config = {
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

async function main() {
    if (watch) {
        const ctx = await esbuild.context(config);
        await ctx.watch();
        console.log('[esbuild] 正在监听文件变更...');
    } else {
        await esbuild.build(config);
        console.log('[esbuild] 构建完成');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
