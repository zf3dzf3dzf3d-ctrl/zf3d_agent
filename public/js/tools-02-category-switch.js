// ==== 拆分自 tools.js：切换分类_写作工具配置（系_写作工具中文名和_调用写作模型（读_敏感词检测（本地_文本统计（本地， ====
Object.assign(Tools, {
        // ===== 切换分类 =====
        setCategory: function(name, chatId) {
            if (this.categories[name]) {
                this.activeCategory = name;
                var cid = chatId || this.currentChatId;
                if (cid) { this.chatCategories[cid] = name; }
                return true;
            }
            return false;
        },


        // ===== 写作工具配置（系统提示词、温度、提示构造器） =====
        _writingTools: {
            rewrite_text: {
                sys: "你是专业中文写作编辑。在严格保持原意的前提下改写文本，改变句式结构和用词表达，降低与原文的重复率。只输出改写后的完整文本，不添加解释或说明。",
                temp: 0.6,
                build: function(a, t) { return "原文：\n"+t+"\n\n改写风格："+(a.style||"自然")+"\n改写力度："+(a.strength||"中度")+"\n要求：保持原意，改变表达方式，降低重复率。"; }
            },
            expand_text: {
                sys: "你是专业内容扩写专家。在保持原文主旨和风格的基础上，丰富细节、补充论据、扩展场景，使内容更加充实饱满。只输出扩写后的完整文本。",
                temp: 0.6,
                build: function(a, t) { return "原文：\n"+t+"\n\n目标长度："+(a.target_length||"扩充一倍")+"\n方向："+(a.direction||"补充细节和论据")+"\n要求：保持原文主旨，丰富内容。"; }
            },
            shorten_text: {
                sys: "你是专业内容精简专家。在保持原文核心信息和逻辑完整的前提下，删减冗余、压缩表达，使内容更加简洁有力。只输出精简后的完整文本。",
                temp: 0.4,
                build: function(a, t) { return "原文：\n"+t+"\n\n目标长度："+(a.target_length||"缩短一半")+"\n要求：保留核心信息，删减冗余。"; }
            },
            polish_text: {
                sys: "你是专业中文写作编辑。先给出1-3条简短的润色说明，然后输出润色后的完整文本。保持原文核心内容不变，优化表达、逻辑和文风。",
                temp: 0.5,
                build: function(a, t) { return "原文：\n"+t+"\n\n目标文风："+(a.style||"更清晰")+"\n目标长度："+(a.target_length||"保持")+"\n润色重点："+(a.focus||"整体表达")+"\n约束："+(a.preserve_meaning!==false?"必须严格保持原意":"可以适度改写"); }
            },
            translate_text: {
                sys: "你是专业翻译。准确翻译文本，保持原文的语气和风格。只输出译文，不添加解释。",
                temp: 0.3,
                build: function(a, t) { return "目标语言："+(a.target_lang||"英语")+"\n\n原文：\n"+t; }
            },
            proofread_text: {
                sys: "你是专业校对编辑。检查文本中的错别字、语法错误、标点问题和逻辑漏洞，逐条列出问题并给出修改建议。如果没有问题，说明文本已无错误。",
                temp: 0.3,
                build: function(a, t) { return "原文：\n"+t+"\n\n请逐条列出错误和修改建议。"; }
            },
            change_tone: {
                sys: "你是语气改写专家。将文本转换为指定语气，保持核心内容不变。直接输出改写后的文本。",
                temp: 0.6,
                build: function(a, t) { return "目标语气："+(a.tone||"正式")+"\n\n原文：\n"+t; }
            },
            professional_edit: {
                sys: "你是学术编辑专家。对文本进行专业级修饰，提升用词精准度、逻辑严密性和表达规范性，使其达到专业出版水平。",
                temp: 0.4,
                build: function(a, t) { return "专业领域："+(a.field||"通用")+"\n\n原文：\n"+t+"\n\n请进行专业级修饰。"; }
            },
            fix_punctuation: {
                sys: "你是标点符号修正专家。检查并修正文本中的标点符号错误，包括中英文标点混用、缺失、多余等问题。直接输出修正后的文本。",
                temp: 0.3,
                build: function(a, t) { return "原文：\n"+t+"\n\n请修正标点符号。"; }
            },
            convert_chars: {
                sys: "你是繁简转换专家。准确进行中文繁体和简体之间的转换，保持其他内容不变。直接输出转换后的文本。",
                temp: 0.3,
                build: function(a, t) { return "转换方向："+(a.direction||"简转繁")+"\n\n原文：\n"+t; }
            },
            summarize_text: {
                sys: "你是资深内容总结专家。输出清晰的结构化总结，包含核心结论、关键事实、待办/下一步；不要添加原文没有的信息。",
                temp: 0.4,
                build: function(a, t) { return "原文：\n"+t+"\n\n目标长度："+(a.target_length||"中")+"\n重点："+(a.focus||"核心结论与行动项"); }
            },
            write_outline: {
                sys: "你是大纲撰写专家。根据主题或要求生成结构化大纲，层次清晰、逻辑合理。直接输出大纲。",
                temp: 0.5,
                build: function(a, t) { return "主题："+(a.topic||t)+"\n格式："+(a.format||"Markdown")+"\n详细程度："+(a.detail_level||"标准"); }
            },
            quick_article: {
                sys: "你是快速写作专家。根据主题和要点快速生成一篇文章，结构完整、内容充实。直接输出文章。",
                temp: 0.6,
                build: function(a, t) { return "主题："+(a.topic||"")+"\n文章类型："+(a.article_type||"通用")+"\n字数："+(a.word_count||"800")+"\n要点："+(a.points||t||"无"); }
            },
            extract_keywords: {
                sys: "你是关键词提取专家。提取最能代表文本核心内容的词语，按重要性排序；只输出关键词，不添加解释。",
                temp: 0.3,
                build: function(a, t) { return "原文：\n"+t+"\n\n数量："+parseInt(a.count||10)+"\n格式："+(a.format||"列表"); }
            },
            extract_outline: {
                sys: "你是文章结构分析专家。从已有文章中反向提取结构化大纲，识别标题层级、段落主题和逻辑关系；只输出大纲，不添加评论。",
                temp: 0.3,
                build: function(a, t) { return "文章：\n"+t+"\n\n格式："+(a.format||"Markdown")+"\n详细程度："+(a.detail_level||"标准"); }
            },
            analyze_sentiment: {
                sys: "你是情感分析专家。分析文章并输出：1)整体情感倾向（积极/消极/中性，给出百分比）；2)情绪强度（强烈/中等/温和）；3)情绪变化轨迹（按段落描述开头-中间-结尾的情绪起伏）；4)情绪把控建议。用清晰Markdown结构化输出，不要改写原文。",
                temp: 0.4,
                build: function(a, t) { return "原文：\n"+t; }
            },
            detect_style: {
                sys: "你是文风分析专家。分析文章的文风特征并输出：1)整体文风判断（正式/口语/学术/文学/新闻等）；2)用词特征（偏书面/偏口语/专业术语密度）；3)句式特征（长句为主/短句为主/句式多样）；4)改进建议。用Markdown结构化输出。",
                temp: 0.4,
                build: function(a, t) { return "原文：\n"+t; }
            },
            compare_text: {
                sys: "你是文本对比分析专家。对比两段文本的差异，从内容、结构、风格、长度等维度进行分析，用Markdown结构化输出。",
                temp: 0.4,
                build: function(a, t) { return "文本A：\n"+(a.text_a||"")+"\n\n文本B：\n"+(a.text_b||"")+"\n\n对比重点："+(a.focus||"全面对比"); }
            },
            rate_article: {
                sys: "你是内容质量评审专家。对文章进行多维度评分（满分10分）：1)内容质量；2)逻辑结构；3)语言表达；4)创新性；5)可读性。给出每项分数和评语，最后给出总分和总评。",
                temp: 0.4,
                build: function(a, t) { return "原文：\n"+t+"\n\n评审维度："+(a.dimensions||"内容、逻辑、表达、创新、可读性"); }
            },
            fact_check: {
                sys: "你是事实核查专家。检查文本中可能存在的事实错误、数据错误和逻辑漏洞，逐条列出问题并给出核查建议。如果内容准确无误，请明确说明。",
                temp: 0.3,
                build: function(a, t) { return "原文：\n"+t+"\n\n请逐条核查事实。"; }
            },
            opposing_view: {
                sys: "你是不同观点生成器。针对文章的核心观点，提出3-5个合理的不同或反对观点，每个观点附简短理由。保持客观理性。",
                temp: 0.6,
                build: function(a, t) { return "原文：\n"+t+"\n\n请提出不同观点。"; }
            },
            role_brainstorm: {
                sys: "你是多角色发散思维专家。从不同角色/视角对主题进行发散性思考，每个角色给出独特见解。",
                temp: 0.7,
                build: function(a, t) { return "主题："+t+"\n角色设定："+(a.roles||"产品经理、用户、开发者、投资人、批评家"); }
            },
            expert_review: {
                sys: "你是资深领域专家。以专家的视角对内容进行深度评析，指出专业性问题和改进方向。",
                temp: 0.5,
                build: function(a, t) { return "领域："+(a.field||"通用")+"\n\n原文：\n"+t+"\n\n请以专家视角评析。"; }
            },
            novice_view: {
                sys: "你是新手读者。以初学者/新手的视角阅读文章，指出看不懂的地方、觉得困难的概念，提出疑问。语气真实自然。",
                temp: 0.6,
                build: function(a, t) { return "原文：\n"+t+"\n\n请以新手视角给出阅读感受和疑问。"; }
            },
            bystander_view: {
                sys: "你是路人读者。以普通路人的视角阅读文章，给出最直观的第一印象和感受，是否吸引人、是否愿意继续看。",
                temp: 0.6,
                build: function(a, t) { return "原文：\n"+t+"\n\n请以路人视角给出第一印象。"; }
            },
            group_discussion: {
                sys: "你是群聊模拟器。模拟一个群聊场景，多个角色围绕主题展开讨论，各抒己见、互相回应，生成生动的群聊记录。",
                temp: 0.7,
                build: function(a, t) { return "主题："+t+"\n参与角色："+(a.roles||"3-5个不同观点的角色")+"\n轮数："+(a.rounds||"3-5轮"); }
            },
            play_devil_advocate: {
                sys: "你是专业抬杠选手。对文章的每个论点都挑毛病、找漏洞、钻牛角尖。语气可以带点挑衅，但抬杠要有理有据，不能无理取闹。",
                temp: 0.6,
                build: function(a, t) { return "原文：\n"+t+"\n\n请对以上内容进行抬杠，找出所有可以反驳的点。"; }
            },
            praise_text: {
                sys: "你是热情的赞美者。发现文章中的所有亮点和优点，给予真诚的赞美。指出具体好在哪里，为什么好，让人感到被认可和鼓舞。",
                temp: 0.6,
                build: function(a, t) { return "原文：\n"+t+"\n\n请发现并赞美以上内容的亮点。"; }
            },
            list_formats: {
                sys: "你是列表整理专家。将文本内容整理成清晰的列表格式。",
                temp: 0.4,
                build: function(a, t) { return "原文：\n"+t+"\n\n列表类型："+(a.list_type||"要点列表")+"\n排序："+(a.sort_by||"按原文顺序"); }
            },
            optimize_ends: {
                sys: "你是开头结尾优化专家。优化文章的开头和结尾，使其更吸引人、更有力。",
                temp: 0.5,
                build: function(a, t) { return "原文：\n"+t+"\n\n优化部分："+(a.part||"开头和结尾")+"\n目标效果："+(a.goal||"开头吸引人，结尾有力"); }
            },
            generate_quotes: {
                sys: "你是金句生成专家。从文章中提炼或改写出精炼有力的金句，适合引用和传播。",
                temp: 0.6,
                build: function(a, t) { return "原文：\n"+t+"\n\n数量："+parseInt(a.count||5)+"\n风格："+(a.style||"精炼有力"); }
            },
            generate_hook: {
                sys: "你是钩子（Hook）生成专家。为文章生成吸引人的开头钩子，让读者忍不住继续阅读。",
                temp: 0.6,
                build: function(a, t) { return "主题/原文：\n"+t+"\n\n钩子类型："+(a.hook_type||"悬念式")+"\n数量："+parseInt(a.count||3); }
            },
            seo_optimize: {
                sys: "你是SEO内容优化专家。输出：1)关键词分析（3-5个目标关键词、频率、密度建议）；2)标题优化建议（2-3个SEO友好标题）；3)meta描述（80-120字含关键词）；4)结构优化建议。用Markdown结构化输出，不改写原文。",
                temp: 0.4,
                build: function(a, t) { return "目标关键词："+(a.keywords||"（未指定，请自动识别）")+"\n\n原文：\n"+t; }
            },
            adapt_audience: {
                sys: "你是内容适配专家。把文章改写成适合指定目标读者阅读的版本：调整词汇难度、句式复杂度、举例方式，保留原文核心信息不改变主旨。直接输出改写后的完整文章。",
                temp: 0.6,
                build: function(a, t) { return "目标读者："+(a.audience||"大众读者")+"\n\n原文：\n"+t; }
            },
            interpret_document: {
                sys: "你是文档解读专家。对文档进行深度解读：提炼核心观点、梳理逻辑脉络、提取关键数据、回答针对性问题。",
                temp: 0.4,
                build: function(a, t) { return "文档内容：\n"+t+"\n\n解读重点："+(a.focus||"核心观点和逻辑脉络"); }
            },
            format_beautify: {
                sys: "你是排版美化专家。对文本进行格式美化：优化标题层级、段落间距、列表格式、引用样式等。直接输出美化后的Markdown文本。",
                temp: 0.4,
                build: function(a, t) { return "原文：\n"+t+"\n\n输出格式："+(a.format||"Markdown"); }
            },
            color_text: {
                sys: "你是视觉文字排版专家。用颜色突出关键词、重点、角色、步骤或情绪，保持原文可读；HTML使用span color，Markdown使用可阅读的标记并说明颜色用途。",
                temp: 0.4,
                build: function(a, t) { return "原文：\n"+t+"\n\n配色："+(a.color_scheme||"主题色")+"\n输出格式："+(a.format||"html"); }
            },
            generate_title: {
                sys: "你是标题生成专家。根据文章内容生成多个吸引人的标题供选择。",
                temp: 0.6,
                build: function(a, t) { return "文章内容：\n"+t+"\n\n数量："+parseInt(a.count||5)+"\n风格："+(a.style||"吸引人"); }
            },
            generate_description: {
                sys: "你是介绍描述生成专家。根据内容生成简洁有力的介绍或描述文案。",
                temp: 0.5,
                build: function(a, t) { return "内容：\n"+t+"\n\n类型："+(a.desc_type||"简介")+"\n字数："+(a.word_count||"100-200字"); }
            }
        },

        // ===== 写作工具中文名和图标 =====
        _writingToolMeta: {
            rewrite_text: { name: "改写", icon: "📝" },
            expand_text: { name: "扩写", icon: "🌱" },
            shorten_text: { name: "缩写", icon: "✂️" },
            polish_text: { name: "润色", icon: "✨" },
            translate_text: { name: "翻译", icon: "🌐" },
            proofread_text: { name: "审校", icon: "🔍" },
            change_tone: { name: "换语气", icon: "🎭" },
            professional_edit: { name: "专业修饰", icon: "🎓" },
            fix_punctuation: { name: "标点修正", icon: "🔧" },
            convert_chars: { name: "繁简转换", icon: "🔄" },
            summarize_text: { name: "总结", icon: "🧾" },
            write_outline: { name: "写大纲", icon: "📋" },
            quick_article: { name: "快速写文章", icon: "⚡" },
            extract_keywords: { name: "提取关键词", icon: "🏷️" },
            extract_outline: { name: "提取大纲", icon: "📐" },
            analyze_sentiment: { name: "情感分析", icon: "💗" },
            detect_style: { name: "文风检测", icon: "🎨" },
            detect_sensitive: { name: "敏感词检测", icon: "🚨" },
            analyze_text_metrics: { name: "文本统计", icon: "📊" },
            compare_text: { name: "文本对比", icon: "🔀" },
            rate_article: { name: "评分", icon: "⭐" },
            fact_check: { name: "事实核查", icon: "✔️" },
            opposing_view: { name: "不同观点", icon: "💭" },
            role_brainstorm: { name: "多角色发散", icon: "🧠" },
            expert_review: { name: "专家视角", icon: "🔬" },
            novice_view: { name: "新手视角", icon: "🐣" },
            bystander_view: { name: "路人视角", icon: "🚶" },
            group_discussion: { name: "群聊", icon: "💬" },
            play_devil_advocate: { name: "抬杠", icon: "😈" },
            praise_text: { name: "夸奖", icon: "👏" },
            list_formats: { name: "列表列举", icon: "📋" },
            optimize_ends: { name: "开头结尾优化", icon: "✏️" },
            generate_quotes: { name: "金句生成", icon: "💎" },
            generate_hook: { name: "钩子生成", icon: "🪝" },
            seo_optimize: { name: "SEO优化", icon: "📈" },
            adapt_audience: { name: "目标读者适配", icon: "🎯" },
            interpret_document: { name: "文档解读", icon: "📖" },
            format_beautify: { name: "格式美化", icon: "💄" },
            color_text: { name: "颜色优化", icon: "🌈" },
            generate_title: { name: "生成标题", icon: "📌" },
            generate_description: { name: "生成介绍描述", icon: "📝" }
        },

        // ===== 调用写作模型（读取模型配置→调用API→返回结果）=====
        _callWritingModel: function(toolName, args, context) {
            context = context || {};
            var chatId = context.chatId || this.currentChatId || '';
            var self = this;
            var cfg = this._writingTools[toolName];
            if (!cfg) return Promise.resolve({ success: false, message: "未知写作工具：" + toolName, tool: toolName });

            // 获取文本：优先 args.text，其次 args.path（需要后端读取）
            var textPromise;
            if (args.path) {
                textPromise = fetch("/api/tools/read", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: args.path, max_chars: 50000, _chat_id: chatId })
                }).then(function(r) { return r.json(); }).then(function(d) {
                    return (d && d.ok && d.content) ? d.content : "";
                }).catch(function() { return ""; });
            } else {
                textPromise = Promise.resolve(args.text || "");
            }

            return textPromise.then(function(text) {
                if (!text || text.trim().length < 2) {
                    return { success: false, message: "未提供文本内容。请通过 text 参数传入需要处理的文本，或通过 path 参数指定文件路径。", tool: toolName };
                }

                // 构造用户消息
                var userMsg = cfg.build(args, text);
                var sysPrompt = cfg.sys;
                var temp = cfg.temp || 0.5;

                // 获取模型配置（优先使用当前对话的模型，其次第一个可用模型）
                var model = null;
                try {
                    // 尝试从当前对话获取模型
                    if (chatId && typeof Store !== "undefined" && Store.data && Store.data.chatBoxes) {
                        for (var ci = 0; ci < Store.data.chatBoxes.length; ci++) {
                            if (Store.data.chatBoxes[ci].id === chatId) {
                                var mid = Store.data.chatBoxes[ci].modelId;
                                if (mid && typeof Models !== "undefined") {
                                    model = Models.get(mid);
                                }
                                break;
                            }
                        }
                    }
                    // 回退到最后一个使用的模型，其次第一个可用模型
                    if (!model && typeof Models !== "undefined" && Models.list && Models.list.length > 0) {
                        var _lu = window._lastUsedModel || null;
                        if (_lu && _lu.endpoint && _lu.modelId) {
                            model = Models.list.find(function(m){ return m && m.key && m.endpoint === _lu.endpoint && m.modelId === _lu.modelId; });
                        }
                        if (!model) model = Models.list[0];
                    }
                } catch(e) {}

                if (!model || !model.endpoint || !model.key) {
                    return { success: false, message: "未配置模型。请在设置中添加模型配置（API endpoint 和 key）。", tool: toolName };
                }

                // 通过后端代理调用模型 API（解决 CORS）
                var headers = { "Content-Type": "application/json" };
                headers["Authorization"] = "Bearer " + model.key;
                if (model.headers) {
                    for (var k in model.headers) { headers[k] = model.headers[k]; }
                }

                var payload = {
                    model: model.modelId,
                    messages: [
                        { role: "system", content: sysPrompt },
                        { role: "user", content: userMsg }
                    ],
                    temperature: temp,
                    stream: false
                };
                if (model.body) {
                    for (var bk in model.body) { if (model.body.hasOwnProperty(bk)) payload[bk] = model.body[bk]; }
                }

                return DB.proxy(model.endpoint, headers, payload).then(function(data) {
                    var reply = "";
                    if (data.choices && data.choices[0] && data.choices[0].message) {
                        reply = data.choices[0].message.content || "";
                    } else if (data.error) {
                        return { success: false, message: "模型调用失败：" + (data.error.message || JSON.stringify(data.error)), tool: toolName };
                    }
                    reply = (reply || "").trim();
                    if (!reply) {
                        return { success: false, message: "模型返回空内容", tool: toolName };
                    }
                    var meta = self._writingToolMeta[toolName] || {};
                    return { success: true, message: (meta.icon || "✍️") + " " + (meta.name || toolName) + "：\n\n" + reply, tool: toolName };
                }).catch(function(err) {
                    return { success: false, message: "请求失败：" + err.message, tool: toolName };
                });
            });
        },

        // ===== 敏感词检测（本地，不调用模型）=====
        _detectSensitive: function(args) {
            var text = args.text || "";
            if (args.path) {
                return fetch("/api/tools/read", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: args.path, max_chars: 50000, _chat_id: chatId })
                }).then(function(r) { return r.json(); }).then(function(d) {
                    return (d && d.ok && d.content) ? d.content : "";
                }).then(function(t) { return Tools._doDetectSensitive(t, args); });
            }
            return Promise.resolve(this._doDetectSensitive(text, args));
        },
        _doDetectSensitive: function(text, args) {
            var ads = ["最","最好","最大","最小","最多","最低","最高","最优","最强","最先进","第一","顶级","极品","绝对","万能","百分百","100%","国家级","世界级","全网第一","销量第一","排名第一","唯一","首个","首家","独家","冠军","之王","之最","巅峰","终极","完美","空前","绝后","史无前例"];
            var platform = ["加微信","加V信","加q群","加QQ群","微信号","vx","VX","免费领","零成本","躺赚","日入过万","月入十万","暴利","刷单","刷销量","刷好评","代刷","特效药","包治百病","药到病除","根治"];
            var political = ["法轮功","六四","天安门事件","藏独","疆独","台独","颠覆国家","反华","辱华"];
            var cats = (args.categories || "").toLowerCase();
            var found = [];
            function scan(list, cat) {
                for (var i = 0; i < list.length; i++) {
                    var w = list[i]; var idx = 0;
                    while ((idx = text.indexOf(w, idx)) >= 0) {
                        found.push({ word: w, category: cat, position: idx });
                        idx += w.length;
                    }
                }
            }
            if (!cats || cats.indexOf("广告") >= 0) scan(ads, "广告法极限词");
            if (!cats || cats.indexOf("平台") >= 0) scan(platform, "平台违规词");
            if (!cats || cats.indexOf("政治") >= 0) scan(political, "政治敏感词");
            if (found.length === 0) {
                return { success: true, message: "🚨 敏感词检测：未发现敏感词。", tool: "detect_sensitive" };
            }
            var lines = ["🚨 敏感词检测：发现 " + found.length + " 处敏感词\n"];
            for (var i = 0; i < found.length; i++) {
                lines.push((i+1) + ". [" + found[i].category + "] \"" + found[i].word + "\" — 位置 " + found[i].position);
            }
            return { success: true, message: lines.join("\n"), tool: "detect_sensitive" };
        },

        // ===== 文本统计（本地，不调用模型）=====
        _analyzeTextMetrics: function(args) {
            var text = args.text || "";
            if (args.path) {
                return fetch("/api/tools/read", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: args.path, max_chars: 100000 })
                }).then(function(r) { return r.json(); }).then(function(d) {
                    return (d && d.ok && d.content) ? d.content : "";
                }).then(function(t) { return Tools._doAnalyzeMetrics(t); });
            }
            return Promise.resolve(this._doAnalyzeMetrics(text));
        },
        _doAnalyzeMetrics: function(text) {
            if (!text || text.length < 1) return { success: false, message: "未提供文本", tool: "analyze_text_metrics" };
            var total = text.length;
            var nonSpace = text.replace(/\s/g, "").length;
            var chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
            var englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
            var punct = (text.match(/[，。！？；：、,.!?;:""''（）()【】《》—…\-]/g) || []).length;
            var paragraphs = text.split(/\n\s*\n/).filter(function(p){return p.trim();}).length;
            var sentences = (text.match(/[。！？.!?]+/g) || []).length;
            var longSentences = 0;
            var sList = text.split(/[。！？.!?]+/);
            for (var i = 0; i < sList.length; i++) { if (sList[i].length > 60) longSentences++; }
            var readMin = Math.ceil(chinese / 400);
            var lines = [
                "📊 文本统计\n",
                "总字符数：" + total,
                "非空白字符：" + nonSpace,
                "中文字符：" + chinese,
                "英文单词：" + englishWords,
                "标点符号：" + punct,
                "段落数：" + paragraphs,
                "句子数：" + sentences,
                "长句数（>60字）：" + longSentences,
                "估算阅读时间：" + readMin + " 分钟"
            ];
            return { success: true, message: lines.join("\n"), tool: "analyze_text_metrics" };
        },
});
