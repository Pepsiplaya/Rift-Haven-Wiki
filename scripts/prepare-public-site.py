"""Publish the portal with content-versioned assets and direct entry pages."""
from pathlib import Path
import hashlib,re,shutil

root=Path(__file__).resolve().parents[1]
target=root/'_site'
target.mkdir(exist_ok=True)
shutil.copytree(root/'assets',target/'assets',dirs_exist_ok=True)
html=(root/'index.html').read_text(encoding='utf-8')
def version_asset(match):
    url=match.group(2)
    digest=hashlib.sha256((root/url.lstrip('/')).read_bytes()).hexdigest()[:16]
    return match.group(1)+url+'?v='+digest+match.group(3)
html=re.sub(r'((?:src|href)=")(/assets/[^"?]+\.(?:js|css))(\")',version_asset,html)
(target/'index.html').write_text(html,encoding='utf-8')
# Fixed portal entry points need no 404 redirect. Dynamic player/article paths
# still restore their original route through the small GitHub Pages fallback.
for route in ['npcs','status','home','profiles','items','market','market/history','guilds','rankings','dungeons','guide','news']:
    folder=target/route;folder.mkdir(parents=True,exist_ok=True)
    (folder/'index.html').write_text(html,encoding='utf-8')
version=hashlib.sha256(html.encode()).hexdigest()[:16]
fallback=(root/'404.html').read_text(encoding='utf-8').replace("location.replace('/');", "location.replace('/?v="+version+"');")
(target/'404.html').write_text(fallback,encoding='utf-8')
shutil.copyfile(root/'CNAME',target/'CNAME')
(target/'.nojekyll').touch()
print('Prepared public portal with versioned assets and direct entry pages.')
