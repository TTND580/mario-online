# 公网部署指南

项目是**零依赖 Node 应用**，不需要 `npm install`，任何能跑 Node 的地方都能跑。
`Dockerfile` 和 `.dockerignore` 已经写好，云平台会自动识别。

---

## 关键：数据持久化

游戏数据在 `data/` 目录（`db.json` + 头像）。

**必须挂持久化磁盘到 `/app/data`**，否则容器重启后所有账号和地图都会没。
各平台都叫 Volume / Disk / 持久化存储，挂载路径填 `/app/data`。

---

## 方案一：Zeabur（国内访问快，推荐）

1. 打开 https://zeabur.com 用 GitHub 登录
2. 新建项目 → Deploy from GitHub → 选这个仓库
3. 它会自动识别 Dockerfile，直接部署
4. 部署完成后：服务 → 存储 → 添加 Volume，挂载路径填 `/app/data`
5. 服务 → 网络 → 生成域名

## 方案二：Railway

1. https://railway.app 用 GitHub 登录
2. New Project → Deploy from GitHub repo
3. 自动识别 Dockerfile
4. 添加 Volume，Mount path 填 `/app/data`
5. Settings → Networking → Generate Domain

## 方案三：Render

1. https://render.com 用 GitHub 登录
2. New → Web Service → 连仓库
3. Runtime 选 **Docker**
4. 加 Disk：Mount Path `/app/data`，大小 1GB 够用很久
5. 免费实例会休眠，第一次访问要等十几秒唤醒

## 方案四：自己的云服务器

```bash
# 装 Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 拉代码
git clone <你的仓库地址> mario-online
cd mario-online

# 用 pm2 常驻
sudo npm i -g pm2
PORT=8787 pm2 start server.mjs --name mario-online
pm2 save && pm2 startup

# Nginx 反代（可选，让 80 端口直接访问）
```

Nginx 配置片段：

```nginx
server {
    listen 80;
    server_name 你的域名;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 8m;   # 头像上传
    }
}
```

---

## 部署前要改的地方

### 1. 端口
本地默认 `8787`，云平台一般要求监听 `PORT` 环境变量。代码已支持：

```js
const PORT = Number(process.env.PORT || 8787);
```

Dockerfile 里设的是 `8080`，按平台要求改。

### 2. 部署后必须做的验证

```bash
# 1. 服务活着
curl https://你的域名/api/info

# 2. 注册能用
curl -X POST https://你的域名/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123456"}'

# 3. 数据持久化（关键）——重启服务后重新注册同名用户
#    如果返回「这个用户名已被注册」，说明 Volume 挂对了
#    如果能重新注册成功，说明数据没持久化，去检查挂载路径
```

### 3. 手机访问

部署好之后，手机直接打开 `https://你的域名` 即可。
**注意**：相机拍照（设头像）在 HTTPS 下才能用，浏览器要求安全上下文。
本地 `http://192.168.x.x` 访问时摄像头会被浏览器禁用，这是正常的，
部署到 HTTPS 域名后就正常了。

---

## 为什么不建议用免费隧道

试过 `localhost.run` 和 `localtunnel`，两者在带 HTTPS 中间人代理的网络环境下都不稳定：

- localhost.run：SSH 转发建立后边缘一直 502
- localtunnel：能拿到地址，但几分钟后变成 `503 Tunnel Unavailable`

隧道只适合临时演示，而且电脑关机就断。要给别人长期玩，还是得真部署。
