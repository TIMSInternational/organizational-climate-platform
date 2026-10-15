"""Normalize artifact-exported drawing names for ClosedXML's 31-character limit.

This changes drawing metadata only; workbook cells, images, formatting and formulas
remain exactly as authored. Run after exporting the branded workbook.
"""
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

path = Path(__file__).resolve().parents[1] / 'src/ClimateProject.Api/Assets/TIMS_NEXA_Clima_Integral.xlsx'
temporary = path.with_suffix('.tmp')
with ZipFile(path) as source, ZipFile(temporary, 'w', ZIP_DEFLATED) as target:
    for entry in source.infolist():
        content = source.read(entry.filename)
        if entry.filename.startswith('xl/drawings/') and entry.filename.endswith('.xml'):
            counter = [0]
            def rename(match):
                counter[0] += 1
                return match.group(1) + ('Brand image ' + str(counter[0])).encode() + match.group(3)
            content = re.sub(rb'(<(?:\w+:)?cNvPr\b[^>]*\bname=")([^"]+)(")', rename, content)
        target.writestr(entry, content)
temporary.replace(path)
