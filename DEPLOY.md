# 公网部署指南

项目是**零依赖 Node 应用**，不需要 `npm install`，任何能跑 Node 的地方都能跑。
`Dockerfile` 和 `.dockerignore` 已写好，云平台会自动识别。

---

## ⚠️ 先看这个：为什么不能用"免费层"

这个项目要存**账号、密码哈希、地图数据**，必须有持久化存储。

| 平台 | 免费层 | 持久化 | 结论 |
| --- | --- | --- | --- |
| Render 免费 | ✅ | ❌ 无磁盘 | ❌ 闲置 15 分钟休眠重启，数据全丢 |
| Koyeb 免费 | ✅ | ❌ 无卷 | ❌ 同上 |
| Zeabur | — | — | ❌ 2026 年已停止服务 |
| **Railway** | $5 试用额度 | ✅ 持久卷 | ✅ **推荐** |

Railway 一个小 Node 应用月成本约 **$0.5~1.5**，$5 试用额度能用好几个月。
如果试用额度用完又不续费，服务会停，但**数据不会丢**，续费就恢复。

---

## 方案一：Railway（推荐）

1. 打开 https://railway.com → **Login** → 选 **GitHub**
2. **New Project** → **Deploy from GitHub repo**
3. 授权并选择 `TTND580/mario-online`
4. Railway 自动识别 Dockerfile 开始构建（1~3 分钟）
5. 构建完成后，点进服务 → **Settings** → **Networking** → **Generate Domain**
6. **必须做**：服务页 → **Volumes** → **Add Volume** → Mount Path 填 `/app/data`

第 6 步不做的话，每次重新部署数据都会清空。

**验证部署成功：**

```bash
curl https://你的域名.up.railway.app/api/info
# 应返回 {"port":8080,"lan":[...],"maps":0,"users":0}
```

---

## 方案二：自己的云服务器（长期最省）

```bash
# 装 Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

git clone https://github.com/TTND580/mario-online.git
cd mario-online

# pm2 常驻
sudo npm i -g pm2
PORT=8787 pm2 start server.mjs --name mario-online
pm2 save && pm2 startup
```

Nginx 反代：

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

本地 `data/` 目录天然持久，不需要额外配置。

---

## 部署后的验收清单

```bash
BASE=https://你的域名

# 1. 服务活着
curl $BASE/api/info

# 2. 注册能用
curl -X POST $BASE/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123456"}'

# 3. 持久化验证（关键）
#    重新部署一次，然后用同一个用户名再注册
#    返回「这个用户名已被注册」= Volume 挂对了
#    能注册成功 = 数据没持久化，去检查挂载路径是不是 /app/data
```

## 手机访问注意

- **相机拍头像必须 HTTPS**，浏览器只在安全上下文开放摄像头。
  Railway 分配的域名自带 HTTPS，所以部署后拍照功能才可用。
- 局域网 `http://192.168.x.x` 下摄像头会被浏览器禁用，这是正常现象。

---

## 为什么放弃免费隧道

实测过 `localhost.run`、`localtunnel`、`pinggy` 三种免费隧道，在带 HTTPS 中间人代理的网络环境下全部失败：

- localhost.run：SSH 转发建立后边缘持续 502
- localtunnel：拿到地址几分钟后变 `503 Tunnel Unavailable`
- pinggy：SSH 连上但不输出公网地址

隧道只适合临时演示，且电脑关机即断。长期给别人玩必须真部署。
