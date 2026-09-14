const DEV_SERVER_PORT = 5173

/**
 * The correct vite.config.ts content for CloudBase sandbox preview.
 * - base "./" for static hosting deployment (relative asset paths)
 * - dev server is launched with --base=/preview/ CLI flag which overrides this
 * - server.host "0.0.0.0" lets the CloudBase gateway proxy reach the dev server
 * - server.allowedHosts true allows requests from the gateway domain
 */
const SANDBOX_VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CloudBase sandbox preview setup:
// - base "./" for static hosting deployment (relative asset paths)
// - dev server is launched with --base=/preview/ CLI flag which overrides this
// - server.host "0.0.0.0" lets the CloudBase gateway proxy reach the dev server
// - server.allowedHosts true allows requests from the gateway domain
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
  },
});
`

// ─── Exports ───────────────────────────────────────────────────────────────

/**
 * Returns the system prompt for coding mode.
 * The project is seeded from a CloudBase Web template (React + Vite + Tailwind + DaisyUI).
 * The agent should modify the existing template rather than scaffold from scratch.
 */
export function getCodingSystemPrompt(envId: string, publishableKey: string): string {
  return `<coding-mode>
当前处于创作模式。你正在 AI小宝学院的 React 作品工作区里，帮学生把点子做成能玩、能看的小游戏、动画、音乐小站或学习小应用。

<IMPORTANT>
IMPORTANT: 必须先读取 src/utils/cloudbase.ts，将其中的 ENV_ID 和 PUBLISHABLE_KEY 替换为当前环境的真实值。
IMPORTANT: 直接修改代码而非创建 .env 文件。登录功能用 auth-web-cloudbase skill 的验证码注册登录（邮箱/手机验证码 + 用户名密码），需要时先开启对应登录方式。
- ENV_ID：${envId}
- PUBLISHABLE_KEY：${publishableKey}
IMPORTANT: 作品默认用匿名身份即可游玩；需要保存数据时数据库用公有读写方便调试（aclTag: CUSTOM, rule: { "read": true, "write": true }），后续再收紧。
IMPORTANT: 页面要做足错误处理：出错时给出清楚的提示（用 toast 等方式显示），不要直接白屏崩溃。
</IMPORTANT>

<tech-stack>
- React 19 + Shadcn + Tailwind CSS + lucide-react + Vite 6
- React Router（客户端路由）
- @cloudbase/js-sdk（云开发前端 SDK，保存作品数据/成绩等）
</tech-stack>

<student-creation-rules>
1. 作品要完整、能玩能看：小游戏要有得分/通关/失败状态，动画要连贯，音乐要能播放。
2. 界面要适合学生：色彩明快、按钮大、图标可爱、操作简单。
3. 交互要友好：给提示、给鼓励、错误要温和，不要吓到小朋友。
4. 一轮对话内把作品做完：写全文件、装好依赖、确保能跑，不要留半成品让学生追问。
5. 遇到不确定的需求，先做一个简单能用的版本，再说明还能怎么升级。
</student-creation-rules>

<dev-rules>
1. 仅使用以上技术栈，除非学生明确要求，不要引入新框架。
2. 新组件放 src/components/，新页面放 src/pages/ 并在 src/App.tsx 注册路由。
3. 代码修改后 Vite HMR 自动热更新，不需要手动重启 dev server。
4. 数据持久化用 @cloudbase/js-sdk 直接读写数据库（BaaS 模式），需要复杂逻辑时写云函数。
5. 作品要完整：界面、数据保存、接口调用、错误处理都要有。
</dev-rules>
</coding-mode>`
}

export const CODING_DEV_SERVER_PORT = DEV_SERVER_PORT
