// ==== 拆分自 tools.js：写作工具定义 ====
Object.assign(Tools, {
            // ===== 写作工具定义 =====
            rewrite_text: {
                type: 'function',
                function: {
                    name: 'rewrite_text',
                    description: '对文本进行改写重述，保持原意但改变表达方式，降低重复率。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要改写的原文' },
                            path: { type: 'string', description: '可选：要改写的文本文件路径' },
                            style: { type: 'string', description: '改写风格，例如 更正式、更口语、更学术、更简洁' },
                            strength: { type: 'string', description: '改写力度：轻度、中度、深度' }
                        },
                        required: []
                    }
                }
            },
            expand_text: {
                type: 'function',
                function: {
                    name: 'expand_text',
                    description: '在保持原文主旨的基础上，丰富细节、补充论据、扩展场景，使内容更加充实饱满。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要扩写的原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            target_length: { type: 'string', description: '目标长度，例如 扩充一倍、扩充到1000字' },
                            direction: { type: 'string', description: '扩写方向，例如 补充细节、增加论据、扩展场景' }
                        },
                        required: []
                    }
                }
            },
            shorten_text: {
                type: 'function',
                function: {
                    name: 'shorten_text',
                    description: '在保持原文核心信息和逻辑完整的前提下，删减冗余、压缩表达，使内容更加简洁有力。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要精简的原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            target_length: { type: 'string', description: '目标长度，例如 缩短一半、300字' }
                        },
                        required: []
                    }
                }
            },
            polish_text: {
                type: 'function',
                function: {
                    name: 'polish_text',
                    description: '对指定文本进行润色改写，可控制文风、目标长度、重点和是否保持原意，并返回改写说明。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要润色的原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            style: { type: 'string', description: '目标文风，例如 更正式、更轻松、更生动' },
                            target_length: { type: 'string', description: '目标长度，例如 保持、缩短、扩充到1000字' },
                            focus: { type: 'string', description: '润色重点，例如 逻辑、表达、细节、说服力' },
                            preserve_meaning: { type: 'boolean', description: '是否严格保持原意，默认true' }
                        },
                        required: []
                    }
                }
            },
            translate_text: {
                type: 'function',
                function: {
                    name: 'translate_text',
                    description: '准确翻译文本，保持原文的语气和风格。只输出译文。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要翻译的原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            target_lang: { type: 'string', description: '目标语言，例如 英语、日语、韩语、法语' }
                        },
                        required: []
                    }
                }
            },
            proofread_text: {
                type: 'function',
                function: {
                    name: 'proofread_text',
                    description: '检查文本中的错别字、语法错误、标点问题和逻辑漏洞，逐条列出问题并给出修改建议。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要校对的原文' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            change_tone: {
                type: 'function',
                function: {
                    name: 'change_tone',
                    description: '将文本转换为指定语气，保持核心内容不变。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要转换语气的原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            tone: { type: 'string', description: '目标语气，例如 正式、轻松、严肃、幽默、热情' }
                        },
                        required: []
                    }
                }
            },
            professional_edit: {
                type: 'function',
                function: {
                    name: 'professional_edit',
                    description: '对文本进行专业级修饰，提升用词精准度、逻辑严密性和表达规范性。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要修饰的原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            field: { type: 'string', description: '专业领域，例如 学术、法律、医学、技术' }
                        },
                        required: []
                    }
                }
            },
            fix_punctuation: {
                type: 'function',
                function: {
                    name: 'fix_punctuation',
                    description: '检查并修正文本中的标点符号错误，包括中英文标点混用、缺失、多余等问题。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要修正标点的原文' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            convert_chars: {
                type: 'function',
                function: {
                    name: 'convert_chars',
                    description: '进行中文繁体和简体之间的转换。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要转换的原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            direction: { type: 'string', description: '转换方向：简转繁、繁转简' }
                        },
                        required: []
                    }
                }
            },
            summarize_text: {
                type: 'function',
                function: {
                    name: 'summarize_text',
                    description: '对文本进行结构化总结，保留关键事实、结论和下一步。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要总结的文本' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            target_length: { type: 'string', description: '总结长度：极短、短、中、长，或具体字数' },
                            focus: { type: 'string', description: '总结重点，例如 结论、风险、行动项、关键数据' }
                        },
                        required: []
                    }
                }
            },
            write_outline: {
                type: 'function',
                function: {
                    name: 'write_outline',
                    description: '根据主题或要求生成结构化大纲。',
                    parameters: {
                        type: 'object',
                        properties: {
                            topic: { type: 'string', description: '大纲主题' },
                            format: { type: 'string', description: '输出格式：Markdown、编号、缩进' },
                            detail_level: { type: 'string', description: '详细程度：粗略、标准、详细' }
                        },
                        required: []
                    }
                }
            },
            quick_article: {
                type: 'function',
                function: {
                    name: 'quick_article',
                    description: '根据主题和要点快速生成一篇文章。',
                    parameters: {
                        type: 'object',
                        properties: {
                            topic: { type: 'string', description: '文章主题' },
                            article_type: { type: 'string', description: '文章类型，例如 通用、技术、评论、故事' },
                            word_count: { type: 'string', description: '目标字数，例如 800、1500' },
                            points: { type: 'string', description: '要点提示' }
                        },
                        required: []
                    }
                }
            },
            extract_keywords: {
                type: 'function',
                function: {
                    name: 'extract_keywords',
                    description: '提取最能代表文本核心内容的词语，按重要性排序。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要提取关键词的文本' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            count: { type: 'integer', description: '关键词数量，默认10' },
                            format: { type: 'string', description: '输出格式：列表、逗号分隔' }
                        },
                        required: []
                    }
                }
            },
            extract_outline: {
                type: 'function',
                function: {
                    name: 'extract_outline',
                    description: '从已有文章反向提取结构化大纲，识别标题层级、段落主题和逻辑关系。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要提取大纲的文章' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            format: { type: 'string', description: '输出格式：Markdown、编号、缩进' },
                            detail_level: { type: 'string', description: '详细程度：粗略、标准、详细' }
                        },
                        required: []
                    }
                }
            },
            analyze_sentiment: {
                type: 'function',
                function: {
                    name: 'analyze_sentiment',
                    description: '分析文章的整体情感倾向、情绪强度、情绪变化轨迹。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要分析的文本' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            detect_style: {
                type: 'function',
                function: {
                    name: 'detect_style',
                    description: '分析文章的文风特征，包括文风判断、用词特征、句式特征和改进建议。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要分析的文本' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            detect_sensitive: {
                type: 'function',
                function: {
                    name: 'detect_sensitive',
                    description: '检测文本中的敏感词、违规词和广告法极限词（本地工具，不调用模型）。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要检测的文本' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            categories: { type: 'string', description: '检测类别，逗号分隔：广告法,平台,政治；默认全部' }
                        },
                        required: []
                    }
                }
            },
            analyze_text_metrics: {
                type: 'function',
                function: {
                    name: 'analyze_text_metrics',
                    description: '统计文本的基本指标：字符数、中英文、标点、段落、句子、长句、阅读时间（本地工具，不调用模型）。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要统计的文本' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            compare_text: {
                type: 'function',
                function: {
                    name: 'compare_text',
                    description: '对比两段文本的差异，包括内容、结构、风格、长度等维度。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text_a: { type: 'string', description: '第一段文本' },
                            text_b: { type: 'string', description: '第二段文本' },
                            focus: { type: 'string', description: '对比重点：内容差异、结构差异、风格差异、全面对比' }
                        },
                        required: []
                    }
                }
            },
            rate_article: {
                type: 'function',
                function: {
                    name: 'rate_article',
                    description: '对文章进行多维度评分（内容、逻辑、表达、创新、可读性），给出评语和总分。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要评分的文章' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            dimensions: { type: 'string', description: '评审维度，默认：内容、逻辑、表达、创新、可读性' }
                        },
                        required: []
                    }
                }
            },
            fact_check: {
                type: 'function',
                function: {
                    name: 'fact_check',
                    description: '检查文本中可能存在的事实错误、数据错误和逻辑漏洞。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '需要核查的文本' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            opposing_view: {
                type: 'function',
                function: {
                    name: 'opposing_view',
                    description: '针对文章的核心观点，提出3-5个合理的不同或反对观点。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            role_brainstorm: {
                type: 'function',
                function: {
                    name: 'role_brainstorm',
                    description: '从不同角色/视角对主题进行发散性思考，每个角色给出独特见解。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '主题或原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            roles: { type: 'string', description: '角色设定，例如 产品经理、用户、开发者' }
                        },
                        required: []
                    }
                }
            },
            expert_review: {
                type: 'function',
                function: {
                    name: 'expert_review',
                    description: '以专家的视角对内容进行深度评析，指出专业性问题和改进方向。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            field: { type: 'string', description: '专业领域，例如 技术、商业、法律' }
                        },
                        required: []
                    }
                }
            },
            novice_view: {
                type: 'function',
                function: {
                    name: 'novice_view',
                    description: '以新手/初学者的视角阅读文章，指出看不懂的地方并提出疑问。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            bystander_view: {
                type: 'function',
                function: {
                    name: 'bystander_view',
                    description: '以普通路人的视角阅读文章，给出最直观的第一印象和感受。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            group_discussion: {
                type: 'function',
                function: {
                    name: 'group_discussion',
                    description: '模拟群聊场景，多个角色围绕主题展开讨论。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '讨论主题' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            roles: { type: 'string', description: '参与角色设定' },
                            rounds: { type: 'string', description: '讨论轮数，例如 3-5轮' }
                        },
                        required: []
                    }
                }
            },
            play_devil_advocate: {
                type: 'function',
                function: {
                    name: 'play_devil_advocate',
                    description: '对文章的每个论点都挑毛病、找漏洞、钻牛角尖，但要有理有据。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            praise_text: {
                type: 'function',
                function: {
                    name: 'praise_text',
                    description: '发现文章的亮点并给予真诚的赞美，指出具体好在哪里。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' }
                        },
                        required: []
                    }
                }
            },
            list_formats: {
                type: 'function',
                function: {
                    name: 'list_formats',
                    description: '将文本内容整理成清晰的列表格式（要点列表、编号列表、任务列表等）。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文或主题' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            list_type: { type: 'string', description: '列表类型：要点列表、编号列表、任务列表、表格' },
                            sort_by: { type: 'string', description: '排序方式：按原文顺序、按重要性' }
                        },
                        required: []
                    }
                }
            },
            optimize_ends: {
                type: 'function',
                function: {
                    name: 'optimize_ends',
                    description: '优化文章的开头和结尾，使其更吸引人、更有力。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            part: { type: 'string', description: '优化部分：开头、结尾、开头和结尾' },
                            goal: { type: 'string', description: '目标效果，例如 开头吸引人、结尾有力' }
                        },
                        required: []
                    }
                }
            },
            generate_quotes: {
                type: 'function',
                function: {
                    name: 'generate_quotes',
                    description: '从文章中提炼或改写出精炼有力的金句。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            count: { type: 'integer', description: '金句数量，默认5' },
                            style: { type: 'string', description: '金句风格，例如 精炼有力、诗意、哲理' }
                        },
                        required: []
                    }
                }
            },
            generate_hook: {
                type: 'function',
                function: {
                    name: 'generate_hook',
                    description: '为文章生成吸引人的开头钩子，让读者忍不住继续阅读。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '主题或原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            hook_type: { type: 'string', description: '钩子类型：悬念式、提问式、数据式、故事式' },
                            count: { type: 'integer', description: '生成数量，默认3' }
                        },
                        required: []
                    }
                }
            },
            seo_optimize: {
                type: 'function',
                function: {
                    name: 'seo_optimize',
                    description: '对内容进行SEO优化分析，输出关键词分析、标题建议、meta描述和结构建议。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            keywords: { type: 'string', description: '目标关键词，不传则自动识别' }
                        },
                        required: []
                    }
                }
            },
            adapt_audience: {
                type: 'function',
                function: {
                    name: 'adapt_audience',
                    description: '按目标读者调整文章的语言难度与表达风格。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            audience: { type: 'string', description: '目标读者，例如 儿童、学生、大众、职场人、专业人士' }
                        },
                        required: []
                    }
                }
            },
            interpret_document: {
                type: 'function',
                function: {
                    name: 'interpret_document',
                    description: '对文档进行深度解读：提炼核心观点、梳理逻辑脉络、提取关键数据。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '文档内容' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            focus: { type: 'string', description: '解读重点：核心观点、逻辑脉络、关键数据' }
                        },
                        required: []
                    }
                }
            },
            format_beautify: {
                type: 'function',
                function: {
                    name: 'format_beautify',
                    description: '对文本进行格式美化：优化标题层级、段落间距、列表格式等。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            format: { type: 'string', description: '输出格式：Markdown、纯文本' }
                        },
                        required: []
                    }
                }
            },
            color_text: {
                type: 'function',
                function: {
                    name: 'color_text',
                    description: '用颜色突出关键词、重点、角色、步骤或情绪。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '原文' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            color_scheme: { type: 'string', description: '配色方案：主题色、暖色、冷色' },
                            format: { type: 'string', description: '输出格式：html、markdown' }
                        },
                        required: []
                    }
                }
            },
            generate_title: {
                type: 'function',
                function: {
                    name: 'generate_title',
                    description: '根据文章内容生成多个吸引人的标题供选择。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '文章内容' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            count: { type: 'integer', description: '标题数量，默认5' },
                            style: { type: 'string', description: '标题风格，例如 吸引人、学术、新闻' }
                        },
                        required: []
                    }
                }
            },
            generate_description: {
                type: 'function',
                function: {
                    name: 'generate_description',
                    description: '根据内容生成简洁有力的介绍或描述文案。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '内容' },
                            path: { type: 'string', description: '可选：文本文件路径' },
                            desc_type: { type: 'string', description: '描述类型：简介、摘要、推荐语' },
                            word_count: { type: 'string', description: '目标字数，例如 100-200字' }
                        },
                        required: []
                    }
                }
            },


        getCategoryList: function(chatId, engineOverride) {
            var cid = chatId || this.currentChatId;
            var curCat = this.chatCategories[cid] || this.activeCategory;
            // ===== 引擎过滤：分类只跟随对应引擎 =====
            // 带 engineId 的分类（Claude Code/Codex/DeepSeek/Hermes/OpenClaw/Pi 引擎工具集）
            // 只在该引擎（且 own_tools=true 的 local_loop 引擎）的对话里显示；
            // preprocess 引擎（如 zf_core 默认/朱峰社区）只显示常规分类（极简/编程/写作/流程图/视觉等）。
            var engId = engineOverride || '';
            if (engId === null || engId === undefined) engId = '';
            if (!engId) {
                try {
                    var _ch = (window.App && Array.isArray(App.chatBoxes))
                        ? App.chatBoxes.filter(function (c) { return c && c.id === cid; })[0] : null;
                    if (_ch) engId = _ch._engine || _ch.engine || '';
                } catch (e) {}
            }
            if (!engId) {
                try { if (typeof DB !== 'undefined' && DB._engine) engId = DB._engine; } catch (e) {}
            }
            var showOwn = false;
            if (engId) {
                var _em = (typeof DB !== 'undefined' && DB.getEngines)
                    ? DB.getEngines().filter(function (x) { return x.id === engId; })[0] : null;
                showOwn = !!(_em && _em.own_tools);
            }
            var list = [];
            for (var k in this.categories) {
                if (this.categories.hasOwnProperty(k)) {
                    var def = this.categories[k];
                    if (def.engineId) {
                        // 引擎专属分类：仅对应引擎的对话显示
                        if (!showOwn || def.engineId !== engId) continue;
                    } else if (showOwn) {
                        // 常规分类（极简/编程/写作/流程图/视觉等）是朱峰社区底层引擎（preprocess/默认）
                        // 独有的；own_tools 引擎（Claude Code/Codex/DeepSeek/Hermes/OpenClaw/Pi）
                        // 只显示自己的引擎分类，不显示常规分类
                        continue;
                    }
                    list.push({
                        name: k,
                        icon: def.icon,
                        desc: def.desc,
                        active: k === curCat
                    });
                }
            }
            return list;
        },
});
