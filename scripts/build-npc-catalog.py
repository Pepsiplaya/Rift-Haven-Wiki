"""Public Rift Haven citizens and released map creatures; never the native NPC dump."""
from pathlib import Path
from zipfile import ZipFile
import hashlib,json,re,subprocess,sys
from PIL import Image
from io import BytesIO

root=Path(__file__).resolve().parents[2];site=root/'Website'
receipt=json.loads((root/'Plugin Source/deployment/current-release.json').read_text(encoding='utf-8-sig'))
jar=root/receipt['jar']
assert hashlib.sha256(jar.read_bytes()).hexdigest()==receipt['jarSha256']
pack=ZipFile(jar);inventory=json.loads((root/receipt['acceptedInventory']).read_text(encoding='utf-8-sig'))
def accepted(path):
    raw=pack.read(path);assert hashlib.sha256(raw).hexdigest()==inventory[path]
    return json.loads(raw)
registry=accepted('defaults/campaign/rift_haven_v2/content/hycitizens/registry.json')['citizens']
dialogs=accepted('defaults/campaign/rift_haven_v2/dialog/npcs/npcs.json')['npcs']
lore=json.loads((site/'assets/data/citizen-lore.json').read_text(encoding='utf-8'))
discovery=json.loads((site/'assets/data/discovery-items.json').read_text(encoding='utf-8'))['items']
slug=lambda value:re.sub('[^a-z0-9]+','-',value.lower()).strip('-')
catalog={};portraits={};citizen_models={}
for citizen in registry:
    name=citizen['name'];key='citizen-'+slug(name)
    if key in catalog:continue # One page per person, regardless of story phase.
    dialog=next((n for n in dialogs if n['npcId']==citizen['npcId']),{})
    role=dialog.get('displayTitle') or next((a for a in citizen['aliases'] if a not in {citizen['npcKey'],name}),'Citizen')
    if role=='The Last King of Valedorn':role='Valedorn'
    assert name in lore, 'Missing current citizen introduction: '+name
    sold=[item for item,d in discovery.items() if any(s.get('merchant')==name for s in d['sources'])]
    entry={'id':key,'name':name,'kind':'citizen','role':role,'lore':lore[name],'items':sold,'drops':[]}
    source=root/'mods/HyCitizensData/citizens'/f'{citizen["hyCitizenId"]}.json'
    if source.is_file():
        local=json.loads(source.read_text(encoding='utf-8-sig'))
        if local.get('is-player-model') and local.get('cached-skin'):
            portraits[key]=local['cached-skin']
        elif local.get('model-id'):
            citizen_models[key]=local['model-id']
    catalog[key]=entry

roles={};models={}
native=ZipFile(Path.home()/'AppData/Roaming/Hytale/install/release/package/game/latest/Assets.zip')
for p in (native,pack):
    for path in p.namelist():
        if path.endswith('.json') and path.startswith(('Server/NPC/Roles/','Server/Models/')):
            (roles if path.startswith('Server/NPC/Roles/') else models)[Path(path).stem]=json.loads(p.read(path))
def resolve_role(role,seen=frozenset()):
    if role not in roles or role in seen:return {},{}
    raw=roles[role];settings,parameters=resolve_role(raw.get('Reference'),seen|{role})
    return {**settings,**raw,**raw.get('Modify',{})},{**parameters,**{k:v.get('Value') for k,v in raw.get('Parameters',{}).items()}}
def resolve_model(model,seen=frozenset()):
    if model not in models or model in seen:return {}
    raw=models[model];return {**resolve_model(raw.get('Parent'),seen|{model}),**raw}
for key,model_id in citizen_models.items():
    model=resolve_model(model_id)
    if model.get('Model') and model.get('Texture'):portraits[key]={'model':model['Model'],'texture':model['Texture']}
map_roles=set(json.loads((site/'assets/data/map-npc-roles.json').read_text(encoding='utf-8')))
assert map_roles <= roles.keys(), 'Placed role missing from accepted/native assets'
for role in sorted(map_roles):
    if role.startswith(('Template_','Component_')) or '_Quest_' in role:continue
    key='creature-'+role
    drops=[];name=None
    for item,d in discovery.items():
        for s in d['sources']:
            if s.get('creature')==role:
                name=s['creatureName'];drops.append({'itemId':item,'description':s.get('method') or 'Can drop when defeated.'})
    level_match=re.search(r'_Level_(\d+)$',role)
    level=int(level_match[1]) if level_match else None;boss='_Boss_' in role
    fallback=re.sub(r'_Level_\d+$','',role).removeprefix('RiftCore_').removeprefix('Overworld_').replace('_',' ')
    name=re.sub(r' \(level \d+\)$','',name or fallback)
    region='Desert' if any(s in role for s in ['Desert_','Pyramid_','Cactee','Scorpion','Snapdragon','Overworld_Scarak']) else 'Crypt' if 'Crypt_' in role else 'Outlander territory' if 'Outlander_' in role else 'Trork territory' if 'Trork_' in role else None
    settings,params=resolve_role(role);appearance=settings.get('Appearance')
    if isinstance(appearance,dict):appearance=params.get(appearance.get('Compute'))
    model=resolve_model(appearance)
    catalog[key]={'id':key,'name':name,'kind':'boss' if boss else 'creature','level':level,'region':region,
        'role':'Overworld boss' if boss else 'Overworld creature','drops':drops,'items':[],
        'lore':f'{name} is '+(f'a level {level} ' if level else 'a ')+('overworld boss.' if boss else 'creature found in Rift Haven.')}
    if model.get('Model') and model.get('Texture'):portraits[key]={'model':model['Model'],'texture':model['Texture']}
    # Native model icons include the complete face, clothing and armor. The
    # standalone renderer cannot assemble these model attachment sets.
    if role.startswith(('Outlander_', 'Trork_')) and model.get('Icon'):
        icon='Common/'+model['Icon']
        source=pack if icon in pack.namelist() else native
        if icon in source.namelist():portraits[key]={'nativeIcon':source.read(icon)}

stage=site/'.local/npc-render';stage.mkdir(parents=True,exist_ok=True)
renderer=root/'.runtime/avatar-renderer';out=site/'assets/images/npcs';out.mkdir(parents=True,exist_ok=True)
def materialize(path):
    relative=path.removeprefix('Common/');assert '..' not in Path(relative).parts
    target=stage/relative
    if not target.exists():
        target.parent.mkdir(parents=True,exist_ok=True)
        name='Common/'+relative
        source=pack if name in pack.namelist() else native
        target.write_bytes(source.read(name))
    return target
rendered=0
for key,visual in portraits.items():
    target=out/(key+'.webp');png=stage/(key+'.png')
    if 'nativeIcon' in visual:
        with Image.open(BytesIO(visual['nativeIcon'])) as image:
            image=image.convert('RGBA');image=image.crop(image.getbbox())
            scale=min(340/image.width,350/image.height)
            image=image.resize((round(image.width*scale),round(image.height*scale)),Image.Resampling.NEAREST)
            canvas=Image.new('RGBA',(384,384));canvas.alpha_composite(image,((384-image.width)//2,384-image.height-12))
            canvas.save(target,lossless=True)
        catalog[key]['portrait']='npcs/'+key;rendered+=1
        continue
    if not target.exists() or ('--refresh-creatures' in sys.argv and key.startswith('creature-')):
        command=[str(renderer/'tools/blockyrender.exe'),'-view','full-body' if 'model' in visual else 'bust','-size','384','-rotation','12','-light','-threads','2','-o',str(png)]
        if 'model' in visual:
            command+=['-model',str(materialize(visual['model'])),'-texture',str(materialize(visual['texture']))]
        else:
            character=stage/(key+'.json');character.write_text(json.dumps(visual),encoding='utf-8')
            command+=['-char',str(character),'-no-defaults','-no-pose']
        result=subprocess.run(command,cwd=renderer,capture_output=True,text=True)
        if result.returncode or not png.exists():continue
        with Image.open(png) as image:image.save(target,lossless=True)
    catalog[key]['portrait']='npcs/'+key;rendered+=1
result={'releaseVersion':receipt['version'],'npcs':list(catalog.values())}
(site/'assets/data/npcs.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print(json.dumps({'citizens':sum(n['kind']=='citizen' for n in catalog.values()),'creatures':sum(n['kind']!='citizen' for n in catalog.values()),'portraits':rendered}))

# Native models from each released dungeon replace the repeated treasure-chest icon.
dungeon_art={}
selections={'khaos_15_20':('Khaos15_Shadow_Knight_Boss','Shadow Knight'),
    'khaos_20_25':('Scarak_Broodmother','Scarak Broodmother'),
    'the_deepworks_30':('Goblin_Gobliterator_Phase1','Gobliterator'),
    'dungeon_of_fear_25_d01':('Fear1_Baron','Baron'),
    'dungeon_of_fear_30_d02':('Fear2_Azaroth','Azaroth'),
    'dungeon_of_fear_30_d03':('Fear3_Katherina','Katherina')}
dungeon_folder=site/'assets/images/dungeons';dungeon_folder.mkdir(exist_ok=True)
for key,(role,name) in selections.items():
    settings,params=resolve_role(role);appearance=settings.get('Appearance')
    if isinstance(appearance,dict):appearance=params.get(appearance.get('Compute'))
    model=resolve_model(appearance or role)
    if not model.get('Model') or not model.get('Texture'):raise ValueError('Missing dungeon model: '+role)
    target=dungeon_folder/(key+'.webp');png=stage/(key+'.png')
    if not target.exists():
        command=[str(renderer/'tools/blockyrender.exe'),'-view','full-body','-size','720','-rotation','12','-light','-threads','2','-model',str(materialize(model['Model'])),'-texture',str(materialize(model['Texture'])),'-o',str(png)]
        run=subprocess.run(command,cwd=renderer,capture_output=True,text=True)
        if run.returncode:raise ValueError('Dungeon render failed: '+role)
        with Image.open(png) as image:image.save(target,lossless=True)
    dungeon_art[key]={'image':'dungeons/'+key,'subject':name}
(site/'assets/data/dungeon-art.json').write_text(json.dumps(dungeon_art,separators=(',',':'))+'\n',encoding='utf-8')
