# ��θ������������һ�������壨���棩

> �ܹ���**Ŀ¼�����**��`server/engines/` ��ÿ���� `manifest.json` + `engine.py` ��Ŀ¼����һ�����棬loader �ȼ����Զ�ʶ��ǰ������ѡ�����Զ����֣�**������κ�ע����롢��������**��

## ��췽ʽ��һ�����ּ�

```bat
cd server\engines
python new_engine.py my_agent                    # ����ѭ��ģʽ�����Լ��Ĺ��߼���
python new_engine.py my_agent --mode preprocess  # ������дģʽ�������ײ㹤��/ģ�ͣ�
python new_engine.py my_agent --name "�ҵ�������" --icon ��
```

���ɺ�������������ߣ��ļ��ڶ��� TODO ��ǣ���

| λ�� | ��ʲô |
|---|---|
| `engine.py` �� `SYSTEM_PROMPT` | �������˸�/����/��ʾ�� |
| `tools/` Ŀ¼ | �Լ��Ĺ��ߣ���ʾ�����߳����Ž�Ŀ¼�Զ����أ� |
| `engine.py` �� `_chat_once()` | ���Լ���ģ�͵��ã�Ĭ����������أ��ɲ��ģ� |

## ����ģʽ��ôѡ

| | `local_loop` ����ѭ�� | `preprocess` ������д |
|---|---|---|
| ģ�͵��� | �����Լ��ܣ��ɻ�����ģ��/���̣� | ���ײ�ͳһ���� |
| ���� | �Լ���һ�ף��������� | �������ȫ�ֹ��� |
| ѭ��/ѹ�� | ������ʵ�֣�����Զ� | �ײ�ͳһ���� |
| ���� | ��������ĳ����Դ�������ѭ���ܹ� | ֻ�뻻�˸�/��ʾ��/��Ϣ�ӹ� |

�ο�ʵ�֣�`codex_style`��������+diff����`pi_style`����ˮ�ߣ���`deepseek_direct`�����򣩡�`zf_core`��preprocess ģ�壩��

## manifest.json �ֶ�

```json
{
  "id": "my_agent",          // ������Ŀ¼ͬ��
  "name": "�ҵ�������",        // ǰ����ʾ��
  "description": "...",
  "version": "0.1.0",
  "enabled": true,            // false ��ǰ������
  "engine_mode": "local_loop",
  "tools": {"source": "self", "dir": "tools/", "list": ["my_agent_echo"]}
}
```

## ͳһ�ӿ�

`engine.py` �����ṩ `run(messages, ctx, on_event=None)`��

- `local_loop`������ OpenAI ������Ӧ `{"choices":[{"message":{"content":...}}]}`����ѡʵ�� `get_tool_schemas()` / `execute_tool_calls()`��
- `preprocess`������ `{"messages": [...]}`�������ײ������ģ�͵��á�����ִ�С���ʽȫ�ɵײ�������

## �ֹ���ʽ

�����ý��ּ�Ҳ���ԣ��ֶ��� `server/engines/xxx/`���� `manifest.json` + `engine.py`�����漴��Ч��

## �ȸ���

- �޸� `engine.py` / `manifest.json` �� mtime �仯��loader �Զ����أ�����������
- ɾ��Ŀ¼�� `enabled: false` �� ǰ�˼�ʱ��ʧ��
