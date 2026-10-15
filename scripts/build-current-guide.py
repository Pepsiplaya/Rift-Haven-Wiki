"""Publish the accepted player handbook and item acquisition links for the site."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[2]
site = root / 'Website'
receipt = json.loads((root / 'Plugin Source/deployment/current-release.json').read_text(encoding='utf-8-sig'))
jar = root / receipt['jar']
if hashlib.sha256(jar.read_bytes()).hexdigest() != receipt['jarSha256']:
    raise ValueError('Accepted release JAR hash mismatch')
with ZipFile(jar) as pack:
    raw = pack.read('guide/handbook.json')
    inventory = json.loads((root / receipt['acceptedInventory']).read_text(encoding='utf-8-sig'))
    if hashlib.sha256(raw).hexdigest() != inventory['guide/handbook.json']:
        raise ValueError('Accepted handbook hash mismatch')
    guide = json.loads(raw)
catalog = json.loads((site / 'assets/data/discovery-items.json').read_text(encoding='utf-8'))
items = catalog['items']
for article in guide['articles']:
    if article['id'] == 'mining':
        for block in article['blocks']:
            if block['text'].startswith('Mining unlocks:'):
                block['text'] = ('Mining unlocks: Copper and Tin at 1, Iron at 10, Adamantite at 20, '
                                 'Mithril at 30, and Onyxium at 45. Better pickaxes and mining perks '
                                 'reduce the hits needed. Keep striking the same node to finish mining it.')
        article['blocks'].append({'text': 'Default ore respawn times: Copper, Tin and Iron 30 seconds; '
            'Adamantite 1 minute; Mithril 2 minutes 30 seconds; Onyxium 10 minutes.'})
    if article['id'] == 'fishing':
        article['blocks'].insert(4, {'text': 'During the catch minigame, Ability 1 (Q) and Ability 2 (E) can also lift the bar.'})

# Item pages in /guide link the same verified acquisition graph as /items.
for item_id, item in items.items():
    blocks = []
    if item.get('description'):
        blocks.append({'text': item['description']})
    links = set()
    for source in item['sources']:
        if source['type'] == 'crafting':
            continue
        name = source.get('merchant') or source.get('creatureName') or source.get('bagName') or source.get('profession', '').title()
        text = source.get('method') or f'Buy {source.get("quantity",1)} for {source.get("priceGold",0)} gold.'
        if source.get('requiredLevel'):
            text += f' {source["profession"].title()} {source["requiredLevel"]} required.'
        link = 'item:' + source['bagId'] if source.get('bagId') else ''
        if link:
            links.add(link)
        blocks.append({'text': f'{name}: {text}', 'link': link})
    for recipe in item['recipes']:
        materials = []
        for ingredient in recipe['inputs']:
            choices = ingredient.get('acceptedItemIds', [ingredient.get('itemId')])
            names = [items[i]['name'] for i in choices if i in items]
            materials.append(f'{ingredient["quantity"]} × ' + (' or '.join(names) or ingredient.get('resourceTypeId', 'material')))
            links.update('item:' + i for i in choices if i in items)
        blocks.append({'text': f'{recipe["bench"]}: {recipe["profession"].title()} {recipe["requiredLevel"]}. '
                       + ', '.join(materials) + f'. Makes {recipe["quantity"]}.'})
    guide['articles'].append({'id': 'item:' + item_id, 'title': item['name'],
        'category': 'Items & Materials', 'summary': 'Where to obtain ' + item['name'] + '.',
        'keywords': item_id + ' ' + item['name'], 'icon': item_id, 'blocks': blocks, 'links': sorted(links)})

# Reuse the production sanitizer, including hidden-material filtering and icon resolution.
run = subprocess.run(['node', '-e', "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(require('./server/guide-data').projectGuide(JSON.parse(s)))));"],
    input=json.dumps(guide, ensure_ascii=False), text=True, encoding='utf-8', cwd=site, capture_output=True, check=True)
result = json.loads(run.stdout)
(site / 'assets/data/guide.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'Published {len(result["articles"])} current guide articles.')
