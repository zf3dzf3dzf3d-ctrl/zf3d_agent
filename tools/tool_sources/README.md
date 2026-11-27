# Tool Frontend Sources

This folder holds the readable JavaScript sources for public browser tools.
The `/tools` segment is blocked by IIS request filtering, so these files are
for maintainers only and are not meant to be served directly.

Workflow:

1. Edit the matching source file in this folder.
2. Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File tools/build_tool_obfuscation.ps1
```

3. Commit both the source file and the regenerated public `.asp` page.

Do not edit the generated obfuscated script block in the public `.asp` files
by hand. It is replaced on the next build.
