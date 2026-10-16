"""Resolve actual item icons/localization from native assets and the accepted RiftCore artifact."""
from pathlib import Path
from zipfile import ZipFile
from PIL import Image
from io import BytesIO
import hashlib,json,re,importlib.util,os
ROOT=Path(__file__).resolve().parents[2]
SITE=ROOT/'Website'
receipt=json.loads(Path(os.environ.get('RIFT_DATA_RELEASE',ROOT/'Plugin Source/deployment/current-release.json')).read_text(encoding='utf-8-sig'))
native=ZipFile(Path.home()/'AppData/Roaming/Hytale/install/release/package/game/latest/Assets.zip')
jar=ROOT/receipt['jar']
if hashlib.sha256(jar.read_bytes()).hexdigest()!=receipt['jarSha256']:
    raise ValueError('Accepted release JAR hash mismatch')
rift=ZipFile(jar)
definitions={}; locale={}; packed={}
for pack in (native,rift):
    for name in pack.namelist():
        if name.startswith('Server/Item/Items/') and name.endswith('.json'):
            try:definitions[Path(name).stem]=json.loads(pack.read(name))
            except (ValueError,UnicodeDecodeError):pass
        if '/en-US/' in name and name.endswith('.lang'):
            namespace='server.' if name.startswith('Server/') else 'common.'
            for line in pack.read(name).decode('utf-8-sig',errors='replace').splitlines():
                if '=' not in line or line.lstrip().startswith('#'):continue
                key,value=line.split('=',1);key=key.strip();value=value.strip()
                locale[key]=value;locale.setdefault(namespace+key,value)
        if name.startswith('Common/Icons/') and name.endswith('.png'):packed[name]=pack
resolved={}
def resolve(key,seen=frozenset()):
    if key in resolved:return resolved[key]
    if key in seen or key not in definitions:return {}
    raw=definitions[key];data=dict(resolve(raw.get('Parent'),seen|{key})) if isinstance(raw.get('Parent'),str) else {}
    data.update(raw);resolved[key]=data;return data
def localized(key):
    text=locale.get(key,key if key and not key.startswith(('server.','common.')) else '')
    return re.sub(r'<[^>]*>','',text).replace('\\n','\n').strip()
def human(key):
    parts=re.sub(r'^(RiftCore_Quality_[A-Z]+_|RiftCore_|NativeSkills_)','',key).split('_')
    return ' '.join(p for p in parts if p not in {'Food','Ingredient','Armor','Weapon','Tool','RiftCore'}).strip()
folder=SITE/'assets/images/items';folder.mkdir(parents=True,exist_ok=True)
catalog={}; icons={};missing=[]
for item_id in sorted(definitions):
    data=resolve(item_id);icon=data.get('Icon')
    if not isinstance(icon,str):continue
    path=icon if icon.startswith('Common/') else 'Common/'+icon
    if path not in packed:missing.append(item_id);continue
    pixels=packed[path].read(path);digest=hashlib.sha256(pixels).hexdigest()[:16]
    if digest not in icons:
        Image.open(BytesIO(pixels)).save(folder/(digest+'.webp'),lossless=True)
        icons[digest]=path
    translation=data.get('TranslationProperties',{})
    name=localized(translation.get('Name','')) or human(item_id)
    entry={'name':name,'icon':'items/'+digest,'rarity':str(data.get('Quality','')).lower() or None}
    description=localized(translation.get('Description',''))
    if description:entry['description']=description
    if isinstance(data.get('MaxStack'),int):entry['maxStack']=data['MaxStack']
    if isinstance(data.get('MaxDurability'),(int,float)):entry['maxDurability']=data['MaxDurability']
    catalog[item_id]=entry
for resource in ['items.json','items-endgame.json','items-fixed.json']:
    try:data=json.loads(rift.read(resource))
    except (KeyError,ValueError):continue
    entries=data if isinstance(data,list) else data.get('items',[]) if isinstance(data,dict) else []
    if isinstance(entries,dict):entries=list(entries.values())
    for template in entries:
        if not isinstance(template,dict):continue
        key=template.get('itemId');base=template.get('baseItem');entry=dict(catalog.get(key,catalog.get(base,{})))
        if not key or not entry:continue
        entry['name']=template.get('displayName') or entry['name']
        if template.get('rarity'):entry['rarity']=str(template['rarity']).lower()
        entry['requiredLevel']=template.get('requiredLevel',1)
        for field in ('slot','weaponType','armorType','requiredMainClass','requiredSubclass','requiredTalent','stats','lore'):
            if template.get(field):entry[field]=template[field]
        catalog[key]=entry
spec=importlib.util.spec_from_file_location('discovery',SITE/'scripts/build-discovery-catalog.py')
discovery=importlib.util.module_from_spec(spec);spec.loader.exec_module(discovery)
inventory=json.loads((ROOT/receipt['acceptedInventory']).read_text(encoding='utf-8-sig'))
catalogs=discovery.compiled_catalogs(jar,receipt,inventory)
for meal in catalogs['preparedMeals']:
    parent=catalog.get(meal['parentItemId'])
    if not parent:raise ValueError('Missing native meal icon: '+meal['parentItemId'])
    catalog[meal['itemId']]={**parent,'name':meal['displayName'],'description':meal['description']}
for potion in catalogs['potions']:
    if potion['id'] in catalog:catalog[potion['id']].update(name=potion['name'],description=potion['description'])
for fish in catalogs['fishing']:
    if fish['itemId'] in catalog:
        catalog[fish['itemId']]['rarity']=fish['frequency'].lower()
(SITE/'assets/data/items.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
for skill,item_id in {'mining':'RiftCore_ProfessionIcon_Mining','foraging':'RiftCore_ProfessionIcon_Foraging','farming':'RiftCore_Seed_Onion','alchemy':'RiftCore_ProfessionIcon_Alchemy','cooking':'RiftCore_ProfessionIcon_Cooking','jewelcrafting':'RiftCore_ProfessionIcon_Jewelcrafting','smithing':'RiftCore_ProfessionIcon_Smithing','weaponsmithing':'RiftCore_ProfessionIcon_Weaponsmithing','fishing':'RiftCore_ProfessionIcon_Fishing','hunter':'RiftCore_ProfessionIcon_Hunter','leatherworking':'RiftCore_ProfessionIcon_Leatherworking','weaving':'RiftCore_ProfessionIcon_Weaving'}.items():
    if item_id in catalog:
        source=folder/(catalog[item_id]['icon'].split('/')[-1]+'.webp')
        (SITE/'assets/images'/('profession-'+skill+'.webp')).write_bytes(source.read_bytes())
print(f'Built {len(catalog)} item mappings, {len(icons)} unique real icons; {len(missing)} unresolved definitions.')
print('Wild Meat:',catalog.get('Food_Wildmeat_Raw'))
