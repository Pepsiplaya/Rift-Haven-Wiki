"""Publish the accepted player handbook and item acquisition links for the site."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import subprocess
import os

root = Path(__file__).resolve().parents[2]
site = root / 'Website'
receipt = json.loads(Path(os.environ.get('RIFT_DATA_RELEASE',root / 'Plugin Source/deployment/current-release.json')).read_text(encoding='utf-8-sig'))
jar = root / receipt['jar']
if hashlib.sha256(jar.read_bytes()).hexdigest() != receipt['jarSha256']:
    raise ValueError('Accepted release JAR hash mismatch')
with ZipFile(jar) as pack:
    raw = pack.read('guide/handbook.json')
    inventory = json.loads((root / receipt['acceptedInventory']).read_text(encoding='utf-8-sig'))
    if hashlib.sha256(raw).hexdigest() != inventory['guide/handbook.json']:
        raise ValueError('Accepted handbook hash mismatch')
    guide = json.loads(raw)
additions=json.loads((site/'assets/data/guide-additions.json').read_text(encoding='utf-8'))
existing={article['id'] for article in guide['articles']}
guide['articles'].extend(article for article in additions['articles'] if article['id'] not in existing)
class_articles={article['id']:article for article in guide['articles']}
for preview in json.loads((site/'assets/data/class-abilities.json').read_text(encoding='utf-8')):
    article=class_articles[preview['articleId']]
    article['blocks'].append({'heading':True,'text':(preview['form']+' abilities') if preview['form'] else 'Signature abilities'})
    for ability in preview['abilities']:
        article['blocks'].append({'heading':True,'text':ability['name']})
        # The approved player-facing description already starts with the card name.
        description=ability['description'].split('\n\n',1)[-1]
        for paragraph in description.split('\n\n'):
            article['blocks'].append({'text':paragraph})
classes=class_articles['classes']
if 'class:druid' not in classes['links']:classes['links'].append('class:druid')
catalog = json.loads((site / 'assets/data/discovery-items.json').read_text(encoding='utf-8'))
items = catalog['items']

# The public site describes the default player group's available commands.
# Public requireNoPermission() commands remain valid without LuckPerms nodes.
# Shop/HUD/duel shortcuts require nodes absent from Bailey's player group;
# use merchant dialogue and Settings instead. Prefer the explicitly granted
# native /spawn over /stuck's separate native Adventure permission group.
for article in guide['articles']:
    article['title']=article['title'].replace('Elemancer','Elementalist')
    if article['id'] == 'commands':
        blocks = []
        skip = False
        for block in article['blocks']:
            if block.get('heading'):
                skip = block['text'] in ('/shop', '/hud on', '/duel')
            if not skip:
                blocks.append(block)
        article['blocks'] = blocks
    if article['id'] == 'pvp':
        article['title'] = 'Arena combat'
        article['summary'] = 'Join arena combat.'
        article['keywords'] = 'pvp arena combat'
        article['blocks'] = [
            {'heading': True, 'text': 'Arena combat'},
            {'text': 'Use /arena to open the arena menu and /arena leave to leave.'}
        ]
    for block in article['blocks']:
        text = block['text']
        if text.startswith('Open /shop and browse'):
            text = ('Talk to a merchant and choose Browse the shop. Select an item, '
                    'check the quantity and total cost, and confirm the purchase. '
                    'Keep room in your inventory for what you buy.')
        text = text.replace('from Rak Kantor or the Fishing section of /shop',
                            'from Rak Kantor through his shop dialogue')
        text = text.replace(' or use /hud on', '')
        text = text.replace('/stuck', '/spawn')
        block['text'] = text

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
    # The compendium lists every combination. Keep the bounded guide concise
    # with single-ingredient examples and the full cooking controls article.
    if item_id.startswith('RiftCore_MealV3__') and len(item_id.split('__')) > 2:
        continue
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
