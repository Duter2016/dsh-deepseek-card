# dsh-deepseek-card

在 DSH Web 顶栏显示 DeepSeek 官方 API 真实余额（直读 `/user/balance`），附带会话命中率与上下文占用。

DSH（DeepSeek Harness）Web 端插件，无第三方依赖。

## 安装

```bash
git clone git@github.com:Duter2016/dsh-deepseek-card.git
cd dsh-deepseek-card
npm pack
dsh plugin --profile web add file:./dsh-deepseek-card-0.1.0.tgz
```

凭证在 DSH 凭据里配置 `DEEPSEEK_API_KEY`（`~/.dsh/.credentials.yaml`）。
tgz 请保留，pnpm 重装需要它。

## 结构

- `lib/index.js` — 服务端：路由、凭证探活、token 记账
- `lib/client.js` — 浏览器端：顶栏胶囊 + 弹出卡片
- `cordis.patch.yml` — bundle patch，挂载到 web profile

## 许可

MIT
