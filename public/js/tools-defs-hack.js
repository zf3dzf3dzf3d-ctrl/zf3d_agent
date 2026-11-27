// ========== tools-defs-hack.js =========
// 黑客分类（网络诊断/安全自检方向）：ping、端口检测、DNS 查询、HTTP 探活、SSL 证书检查
// 定位：自有服务器/授权资产的运维诊断工具，不是攻击工具
registerToolDefs({
  tools: {
    "net_ping": {
      "type": "function",
      "function": {
        "name": "net_ping",
        "description": "Ping 主机测连通性与延迟。仅用于自有/授权资产的网络诊断。",
        "parameters": {
          "type": "object",
          "properties": {
            "host": { "type": "string", "description": "目标主机（IP 或域名）" },
            "count": { "type": "integer", "description": "Ping 次数，默认 4" }
          },
          "required": ["host"]
        }
      }
    },
    "port_scan": {
      "type": "function",
      "function": {
        "name": "port_scan",
        "description": "检测目标主机指定端口是否开放（TCP 连接测试）。仅用于自检自有服务器端口暴露情况。",
        "parameters": {
          "type": "object",
          "properties": {
            "host": { "type": "string", "description": "目标主机（IP 或域名）" },
            "ports": {
              "type": "array",
              "items": { "type": "integer" },
              "description": "端口列表，如 [80, 443, 22]。最多 20 个"
            },
            "timeout": { "type": "number", "description": "单个端口超时秒数，默认 3" }
          },
          "required": ["host", "ports"]
        }
      }
    },
    "dns_query": {
      "type": "function",
      "function": {
        "name": "dns_query",
        "description": "查询域名的 DNS 解析记录（A/AAAA/CNAME/MX/TXT/NS）。",
        "parameters": {
          "type": "object",
          "properties": {
            "domain": { "type": "string", "description": "要查询的域名" },
            "type": { "type": "string", "description": "记录类型：A/AAAA/CNAME/MX/TXT/NS，默认 A" }
          },
          "required": ["domain"]
        }
      }
    },
    "http_probe": {
      "type": "function",
      "function": {
        "name": "http_probe",
        "description": "HTTP 探活：请求 URL 返回状态码、响应头、耗时，用于检查自己网站/接口可用性。",
        "parameters": {
          "type": "object",
          "properties": {
            "url": { "type": "string", "description": "目标 URL（http/https）" },
            "method": { "type": "string", "description": "HTTP 方法，默认 GET" },
            "timeout": { "type": "number", "description": "超时秒数，默认 10" }
          },
          "required": ["url"]
        }
      }
    },
    "ssl_check": {
      "type": "function",
      "function": {
        "name": "ssl_check",
        "description": "检查 HTTPS 站点证书：颁发者、有效期、剩余天数，用于监控自己域名证书快过期。",
        "parameters": {
          "type": "object",
          "properties": {
            "host": { "type": "string", "description": "域名（不带 https://）" },
            "port": { "type": "integer", "description": "端口，默认 443" }
          },
          "required": ["host"]
        }
      }
    },
    "whois_query": {
      "type": "function",
      "function": {
        "name": "whois_query",
        "description": "查询域名 WHOIS 注册信息（注册商、注册/到期时间、NS）。用于管理自己域名的到期监控。",
        "parameters": {
          "type": "object",
          "properties": {
            "domain": { "type": "string", "description": "域名，如 example.com" }
          },
          "required": ["domain"]
        }
      }
    },
    "traceroute": {
      "type": "function",
      "function": {
        "name": "traceroute",
        "description": "路由追踪：查看到目标主机的网络路径与每跳延迟。用于诊断自己服务器链路。",
        "parameters": {
          "type": "object",
          "properties": {
            "host": { "type": "string", "description": "目标主机（IP 或域名）" },
            "max_hops": { "type": "integer", "description": "最大跳数，默认 15，上限 30" }
          },
          "required": ["host"]
        }
      }
    },
    "ip_geo": {
      "type": "function",
      "function": {
        "name": "ip_geo",
        "description": "查询 IP 归属地/ISP/反查域名。不传 ip 则返回本机出口 IP。",
        "parameters": {
          "type": "object",
          "properties": {
            "ip": { "type": "string", "description": "要查询的 IP，留空查本机出口 IP" }
          },
          "required": []
        }
      }
    },
    "http_headers": {
      "type": "function",
      "function": {
        "name": "http_headers",
        "description": "HTTP 安全响应头检查：检测 HSTS/CSP/X-Frame-Options 等是否配置，并报告 Server 版本信息泄露。用于加固自己的网站。",
        "parameters": {
          "type": "object",
          "properties": {
            "url": { "type": "string", "description": "站点 URL 或域名" }
          },
          "required": ["url"]
        }
      }
    },
    "cdn_check": {
      "type": "function",
      "function": {
        "name": "cdn_check",
        "description": "CDN 检测：多地区 DNS 解析交叉比对 + IP 组织特征，判断域名是否套了 CDN/代理（自检源站是否暴露）。",
        "parameters": {
          "type": "object",
          "properties": {
            "domain": { "type": "string", "description": "域名（不带协议）" }
          },
          "required": ["domain"]
        }
      }
    },
    "password_audit": {
      "type": "function",
      "function": {
        "name": "password_audit",
        "description": "本地密码强度自检：按常见弱口令字典/键盘连排/词根规则评估密码强度。纯本地计算不上传。支持传 file 批量审计本地密码文件。",
        "parameters": {
          "type": "object",
          "properties": {
            "password": { "type": "string", "description": "要检测的密码（建议用测试密码，不要传真实在用密码）" },
            "file": { "type": "string", "description": "本地密码文件路径（每行一个，批量审计用），与 password 二选一" }
          },
          "required": []
        }
      }
    },
    "subdomain_enum": {
      "type": "function",
      "function": {
        "name": "subdomain_enum",
        "description": "子域名枚举：基于证书透明日志（crt.sh）查询某域名下已签发证书的子域名，用于自有资产盘点。",
        "parameters": {
          "type": "object",
          "properties": {
            "domain": { "type": "string", "description": "主域名，如 example.com" }
          },
          "required": ["domain"]
        }
      }
    },
    "sensitive_file_probe": {
      "type": "function",
      "function": {
        "name": "sensitive_file_probe",
        "description": "敏感文件暴露自检：探测自有站点常见敏感路径（.env/.git/备份文件等）是否可公开访问。",
        "parameters": {
          "type": "object",
          "properties": {
            "url": { "type": "string", "description": "站点地址，如 example.com 或 https://example.com" },
            "paths": { "type": "array", "items": { "type": "string" }, "description": "可选：自定义探测路径列表，默认用内置常见路径（最多 30 个）" }
          },
          "required": ["url"]
        }
      }
    }
  }
});
