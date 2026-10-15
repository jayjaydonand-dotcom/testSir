# ontology-platform（Spring Boot 内嵌 WebProtege）

通过 **正规 Maven 依赖** 使用 `webprotege-master` 编译安装到本地仓库的模块，业务代码在 `backend/src`。

## 目录

```
ontology-platform/
  backend/                 Spring Boot（:18090）
    pom.xml                依赖 edu.stanford.protege:webprotege-server-core 等
    src/
  frontend/                Vue 建模页（:5173）
  scripts/
    install-webprotege.ps1 对 webprotege-master 执行 mvn install（做一次/改 WP 后）
    run-embedded.ps1       mvn spring-boot:run
```

## 依赖关系

```text
webprotege-master  ──mvn install──►  本地 .m2（edu.stanford.protege:*）
                                              │
                                              ▼
                                 ontology-platform/backend（pom 引用）
```

改了 WebProtege 源码后：重新跑 `install-webprotege.ps1`，再启动/打包 backend。

## 首次准备

```powershell
cd d:\benti2\ontology-platform
.\scripts\install-webprotege.ps1
```

等价于在 `D:\benti2\webprotege-master` 安装 server 相关模块（跳过 GWT client），坐标示例：

- `edu.stanford.protege:webprotege-server-core:5.0.0-SNAPSHOT`
- `edu.stanford.protege:webprotege-server:5.0.0-SNAPSHOT:jar:classes`

本机 Maven 仓库若在 `settings.xml` 里配置了 `localRepository`（例如 `D:\repository`），制品会装到那里。

## 启动后端

```powershell
# Mongo 需可达 localhost:27017；不要同时跑 Tomcat webprotege
docker stop webprotege   # 如有

cd backend
mvn -DskipTests spring-boot:run
# 或
.\scripts\run-embedded.ps1
```

打包：

```powershell
cd backend
mvn -DskipTests package
```

## 配置

`backend/src/main/resources/application.yml`：

```yaml
webprotege:
  mode: embedded
  data-directory: D:/benti2/webprotege-master/.protegedata/protege
  mongodb-host: localhost
  mongodb-port: 27017
```

## 前端

```bash
cd frontend
npm install
npm run dev
```

打开 http://127.0.0.1:5173
