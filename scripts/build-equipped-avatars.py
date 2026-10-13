"""Build cached native equipped avatars from an already-public snapshot.

No SQL access. Does not invent models or publish raw inventory. Missing assets
or unsupported offhand items leave the existing cosmetic avatar as fallback.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
RENDERER = ROOT / '.runtime/avatar-renderer'
SOURCE = ROOT / 'Plugin Source/src/main/resources'
FIELDS = dict(bodyCharacteristic='BodyCharacteristics', underwear='Underwear',
    face='Faces', eyes='Eyes', ears='Ears', mouth='Mouths', haircut='Haircuts',
    eyebrows='Eyebrows', facialHair='FacialHair', pants='Pants', undertop='Undertops',
    overtop='Overtops', shoes='Shoes', gloves='Gloves', overpants='Overpants',
    cape='Capes', faceAccessory='FaceAccessory', headAccessory='HeadAccessory',
    earAccessory='EarAccessory')
ARMOR_FIELDS = {'head':'headAccessory','chest':'overtop','hands':'gloves','legs':'overpants'}
HIDE = {'EarAccessory':'earAccessory','Ear':'ears','Ears':'ears','Haircut':'haircut',
    'HeadAccessory':'headAccessory','Overtop':'overtop','Undertop':'undertop',
    'Gloves':'gloves','Pants':'pants','Overpants':'overpants','Shoes':'shoes',
    'FaceAccessory':'faceAccessory','Cape':'cape'}
VISUAL = set(ARMOR_FIELDS) | {'mainHand','offHand'}

def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

def selector_hash(appearance, equipment):
    skin = {k:appearance[k] for k in sorted(appearance) if k in FIELDS
        and isinstance(appearance[k],str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',appearance[k])}
    skin_hash = hashlib.sha256(compact(skin).encode()).hexdigest()[:24]
    selectors = sorted(f"{x['position']}:{x['itemId']}" for x in equipment
        if x.get('position') in VISUAL and x.get('itemId'))
    return hashlib.sha256((skin_hash+'|'+ '|'.join(selectors)).encode()).hexdigest()[:24]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',type=Path,default=ROOT/'.runtime/public-snapshot.json')
    ap.add_argument('--assets',type=Path,default=Path(os.environ['APPDATA'])/'Hytale/install/release/package/game/latest/Assets.zip')
    ap.add_argument('--limit',type=int,default=10000)
    args=ap.parse_args()
    snapshot=json.loads(args.input.read_text(encoding='utf-8'))
    stage=ROOT/'.runtime/equipped-avatar-cache'
    stage.mkdir(parents=True,exist_ok=True)
    for sub in ['data','assets','output','characters']:(stage/sub).mkdir(exist_ok=True)
    catalogs={p.stem:json.loads(p.read_text(encoding='utf-8')) for p in (RENDERER/'data').glob('*.json')}
    zip_assets=zipfile.ZipFile(args.assets)
    native_items={Path(p).stem:p for p in zip_assets.namelist() if p.startswith('Server/Item/Items/') and p.endswith('.json')}
    source_items={p.stem:p for p in (SOURCE/'Server/Item/Items').rglob('*.json')}

    def item_definition(item_id, seen=None):
        seen=set() if seen is None else seen
        if item_id in seen:raise ValueError('Cyclic item inheritance')
        seen.add(item_id)
        key=re.sub(r'^RiftCore_Quality_(?:POOR|COMMON|UNCOMMON|RARE|EPIC|LEGENDARY|SET|MYTHIC)_','',item_id)
        if key in source_items:d=json.loads(source_items[key].read_text(encoding='utf-8'))
        elif key in native_items:d=json.loads(zip_assets.read(native_items[key]))
        else:raise ValueError('Unavailable item definition')
        item_dir=stage/'data/Items'
        item_dir.mkdir(exist_ok=True)
        (item_dir/f'{key}.json').write_text(compact(d),encoding='utf-8')
        inherited=item_definition(d['Parent'],seen) if d.get('Parent') else {}
        result={**inherited,**d}
        if isinstance(inherited.get('Armor'),dict):result['Armor']={**inherited['Armor'],**d.get('Armor',{})}
        return result

    def materialize(path):
        if not isinstance(path,str) or not path.endswith(('.png','.blockymodel','.blockyanim')):return
        path=path.replace('\\','/').removeprefix('Common/')
        if '..' in Path(path).parts or Path(path).is_absolute():raise ValueError('Invalid asset path')
        dst=stage/'assets'/path
        if dst.exists():return
        dst.parent.mkdir(parents=True,exist_ok=True)
        source=SOURCE/'Common'/path
        cached=RENDERER/'assets'/path
        if source.is_file():shutil.copyfile(source,dst)
        elif cached.is_file():os.link(cached,dst)
        else:dst.write_bytes(zip_assets.read('Common/'+path))

    def refs(value):
        if isinstance(value,dict):
            for v in value.values():refs(v)
        elif isinstance(value,list):
            for v in value:refs(v)
        else:materialize(value)

    refs(catalogs['GradientSets'])
    materialize('Characters/Player.blockymodel')
    materialize('Characters/Player_Textures/Player_Greyscale.png')
    output=ROOT/'Website/assets/avatars'
    mapping={}
    failures=0
    for player in snapshot.get('players',[])[:args.limit]:
        appearance=player.get('appearance',{})
        equipment=player.get('equipment',[])
        if not appearance or not any(x.get('position') in VISUAL for x in equipment):continue
        try:
            visual=dict(appearance)
            shown=[]
            omitted=['offHand'] if any(x.get('position')=='offHand' and x.get('itemId') for x in equipment) else []
            local_catalogs={k:list(v) if isinstance(v,list) else v for k,v in catalogs.items()}
            for entry in equipment:
                position=entry.get('position')
                if position not in ARMOR_FIELDS:continue
                try:
                    definition=item_definition(entry['itemId'])
                    model,texture=definition.get('Model'),definition.get('Texture')
                    if not model or not texture:raise ValueError('Equipped armor model or texture unavailable')
                    materialize(model);materialize(texture)
                except (ValueError,KeyError,OSError):
                    omitted.append(position)
                    continue
                for hidden in definition.get('Armor',{}).get('CosmeticsToHide',[]):
                    if hidden in HIDE:visual.pop(HIDE[hidden],None)
                field=ARMOR_FIELDS[position]
                synthetic='Equipped_'+position
                local_catalogs[FIELDS[field]].append({'Id':synthetic,'Model':model,
                    'Textures':{'Native':{'Texture':texture}}})
                visual[field]=synthetic+'.Native'
                shown.append(position)
            for field,selection in visual.items():
                if field not in FIELDS:continue
                entry_id=selection.split('.')[0]
                entry=next((e for e in local_catalogs[FIELDS[field]] if e.get('Id')==entry_id
                    or entry_id in e.get('FallbackPartIds',[])
                    or any(v.get('FallbackPartId')==entry_id for v in e.get('Variants',{}).values())),None)
                if entry:refs(entry)
                else:raise ValueError('Unknown saved cosmetic needs native alias resolution')
            for name,catalog in local_catalogs.items():
                (stage/'data'/f'{name}.json').write_text(compact(catalog),encoding='utf-8')
            key=selector_hash(appearance,equipment)
            character=stage/'characters'/f'{key}.json'
            character.write_text(compact(visual),encoding='utf-8')
            command=[str(RENDERER/'tools/blockymerge.exe'),'-char',str(character),
                '-format','glb','-no-defaults','-no-pose','-out',key]
            held=next((x for x in equipment if x.get('position')=='mainHand'),None)
            if held:
                # Current native tool resolves authored item assets and their own
                # hold transform. It may reject weapons; never replace with cubes.
                native_id=re.sub(r'^RiftCore_Quality_(?:POOR|COMMON|UNCOMMON|RARE|EPIC|LEGENDARY|SET|MYTHIC)_','',held['itemId'])
                try:
                    definition=item_definition(held['itemId'])
                    if definition.get('Model'):materialize(definition['Model'])
                    if definition.get('Texture'):materialize(definition['Texture'])
                    command += ['-hold-block',native_id,'-pack',str(SOURCE)]
                except (ValueError,KeyError,OSError):
                    omitted.append('mainHand')
                    held=None
            result=subprocess.run(command,cwd=stage,capture_output=True,text=True)
            if held and result.returncode:
                omitted.append('mainHand')
                result=subprocess.run(command[:command.index('-hold-block')],cwd=stage,capture_output=True,text=True)
            elif held:
                shown.append('mainHand')
            if not shown:raise ValueError('No equipped geometry available')
            glb=stage/'output'/f'{key}.glb'
            if result.returncode or not glb.is_file():raise ValueError('Native renderer rejected equipped appearance')
            output.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(glb,output/glb.name)
            mapping[player['name']]={'hash':key,'shown':sorted(shown),'omitted':sorted(omitted),
                'allowedSelectors':sorted(f"{x['position']}:{x['itemId']}" for x in equipment
                    if x.get('position') in VISUAL and x.get('itemId'))}
        except (ValueError,KeyError,OSError,StopIteration):
            failures+=1
    dest=ROOT/'Website/assets/data/equipped-avatar-map.json'
    dest.write_text(compact(mapping)+'\n',encoding='utf-8')
    print(f'Equipped native avatar cache: {len(mapping)} profiles; {failures} retain cosmetic fallback.')

if __name__=='__main__':main()
