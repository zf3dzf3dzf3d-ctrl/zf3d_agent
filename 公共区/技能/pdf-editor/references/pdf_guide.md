# PDF Processing Reference

## Library Comparison

| Library | Best For | Install |
|---------|----------|---------|
| pdfplumber | Text extraction, tables | pip install pdfplumber |
| PyPDF2 | Page manipulation, merge, split | pip install PyPDF2 |
| pdf2image | PDF to image conversion | pip install pdf2image |

## Common Patterns

### Extract Tables
```python
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    for page in pdf.pages:
        tables = page.extract_tables()
```

### Rotate Pages
```python
from PyPDF2 import PdfReader, PdfWriter
reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages:
    page.rotate(90)
    writer.add_page(page)
with open("output.pdf", "wb") as f:
    writer.write(f)
```
