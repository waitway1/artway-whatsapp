# ArtwayWhatsapp

Windows 桌面 WhatsApp 多账号与客户消息管理软件。

- 独立账号登录与会话隔离。
- Excel 客户导入、分组、搜索和编辑。
- 保存消息模板，发送文字、图片和附件。
- 支持号码测试、发送结果和联系次数记录。
- 托盘后台运行，客户资料和登录数据保存在本机。

## 安装

在 [Releases](https://github.com/waitway1/artway-whatsapp/releases/latest) 下载 Windows x64 安装包，安装后扫码登录 WhatsApp。

## 开发

```powershell
npm ci
npm run dev
```

## 构建与验证

```powershell
npm test
npm run build
npm run pack:win
npm run test:packaged
```
