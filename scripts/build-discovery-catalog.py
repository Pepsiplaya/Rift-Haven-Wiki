"""Build a conservative player-obtainable discovery graph from the accepted release.

Asset existence never admits an item. Admission needs a named merchant, a released
gathering/hunting/bag route, or a recipe with obtainable ingredients.
This offline snapshot is not a claim about live stock or custom server overrides.
"""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import re
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / 'Website'
RECEIPT = ROOT / 'Plugin Source/deployment/current-release.json'
BAR_LEVELS = {'Copper': 1, 'Tin': 1, 'Bronze': 1, 'Silver': 1, 'Gold': 1,
              'Iron': 12, 'Steel': 12, 'Thorium': 24, 'Adamantite': 24,
              'Cobalt': 36, 'Mithril': 36, 'Onyxium': 48,
              'Steel_Ancient': 48, 'Ancient_Steel': 48}
SAFE_WEAPONS = {'Weapon_Daggers', 'Weapon_Sword', 'Weapon_Battleaxe',
                'Weapon_Club', 'Weapon_Staff', 'Weapon_Fist', 'Weapon_Shield'}


def compiled_catalogs(jar, receipt, inventory):
    """Invoke pure static catalogs from accepted bytecode, never a game server."""
    classes = {'alchemy': ('alchemy.AlchemyRecipeCatalog', 'all'),
               'cooking': ('cooking.CookingRecipeCatalog', 'all'),
               'farming': ('farming.FarmingCropCatalog', 'all'),
               'fishing': ('fishing.FishingSpeciesCatalog', 'all'),
               'bands': ('jewelcrafting.JewelcraftingCatalog', 'bandRecipes'),
               'sockets': ('jewelcrafting.JewelcraftingCatalog', 'socketRecipes'),
               'refining': ('jewelcrafting.JewelcraftingCatalog', 'refiningRecipes'),
               'gems': ('jewelcrafting.JewelcraftingCatalog', 'gems'),
               'bagMaterials': ('fishing.FishingBagLoot', 'materials'),
               'brushes': ('gathering.ForagingBushCatalog', 'getDefinitions')}
    with ZipFile(jar) as pack:
        for name, _ in classes.values():
            path = 'com/mmoserver/riftcore/' + name.replace('.', '/') + '.class'
            if hashlib.sha256(pack.read(path)).hexdigest() != inventory.get(path):
                raise ValueError('Accepted catalog bytecode mismatch: ' + path)
    java = Path(os.environ.get('DISCOVERY_JAVA',
                'C:/Program Files/Eclipse Adoptium/jdk-25.0.1.8-hotspot/bin/java.exe'))
    server_hash = receipt.get('serverSha256',
        'c3b5985b9e72727bf3bcf220923d7e61e78fe0f37cd1cd9c2a73f51e4f408ff8')
    server = ROOT / '.runtime/hytale-server' / ('HytaleServer-' + server_hash + '.jar')
    if hashlib.sha256(server.read_bytes()).hexdigest() != server_hash:
        raise ValueError('Server dependency JAR hash mismatch')
    invocations = ''.join('result.put("' + key + '", Class.forName("com.mmoserver.riftcore.'
                          + name + '").getMethod("' + method + '").invoke(null));'
                          for key, (name, method) in classes.items())
    source = ('import java.util.*; import com.google.gson.Gson; '
              'class DiscoveryExport { public static void main(String[] args) throws Exception {'
              'Map<String,Object> result=new LinkedHashMap<>();' + invocations +
              'var tiers=new ArrayList<Object>();'
              'for(var t:com.mmoserver.riftcore.fishing.FishingBagLoot.Tier.values())'
              'tiers.add(Map.of("id",t.bagId(),"label",t.label(),"cost",t.fishCost,'
              '"min",t.min,"max",t.max,"gemMax",t.gemMax,"count",t.materialCount()));'
              'result.put("bags",tiers);System.out.println(new Gson().toJson(result)); }}')
    with tempfile.TemporaryDirectory(prefix='rift-discovery-') as scratch:
        helper = Path(scratch) / 'DiscoveryExport.java'
        helper.write_text(source, encoding='utf-8')
        run = subprocess.run([str(java), '--class-path', str(jar) + os.pathsep + str(server),
                              str(helper)], text=True, capture_output=True, check=True, timeout=90)
        return json.loads(run.stdout.strip().splitlines()[-1])


def safe(item):
    if item in {'Ore_Thorium','Ore_Cobalt','Ingredient_Ore_Thorium','Ingredient_Ore_Cobalt','Ingredient_Bar_Thorium','Ingredient_Bar_Cobalt','Salvage_Thorium','Salvage_Cobalt'}:
        return False
    return bool(item) and not re.search(
        r'(?i)(template|_lesson_|_training_|_quest_|professionicon|perkicon|talenticon|'
        r'_talent_|_debug|_admin|_test|_experimental|_placeholder)', item)


def visible(recipe):
    output, category = recipe.get('outputId', ''), recipe.get('categoryId', '')
    if not safe(output):
        return False
    if output.startswith('Weapon_') and output != 'Weapon_Staff_Bo_Bamboo' and any(
            token in output for token in ('_Crude', '_Thorium', '_Cobalt', '_Wood',
                                          '_Bronze', '_Ancient_Steel')):
        return False
    if output.startswith(('Armor_Thorium_', 'Armor_Cobalt_', 'Armor_Steel_Ancient_')):
        return False
    if recipe.get('benchId') == 'Weapon_Bench':
        return (category in SAFE_WEAPONS and output.startswith(category + '_')
                and output != 'Weapon_Club_Iron_Rusty')
    return (recipe.get('benchId') == 'Armor_Bench' and
            (category == 'Armor_Bolts' or re.fullmatch(
                r'Armor_(Cloth|Leather|Mail|Plate)_(Head|Chest|Legs|Hands)', category)))


def build():
    receipt = json.loads(RECEIPT.read_text(encoding='utf-8-sig'))
    jar_path = ROOT / receipt['jar']
    if hashlib.sha256(jar_path.read_bytes()).hexdigest() != receipt['jarSha256']:
        raise ValueError('Accepted release JAR hash mismatch')
    inventory = json.loads((ROOT / receipt['acceptedInventory']).read_text(encoding='utf-8-sig'))
    catalogs = compiled_catalogs(jar_path, receipt, inventory)
    metadata = json.loads((SITE / 'assets/data/items.json').read_text(encoding='utf-8'))
    output, candidates, creature_loot = {}, {}, {}
    def recipe_for(item, recipe):
        rows = candidates.setdefault(item, [])
        if recipe not in rows:
            rows.append(recipe)
    with ZipFile(jar_path) as rift, ZipFile(Path.home() /
            'AppData/Roaming/Hytale/install/release/package/game/latest/Assets.zip') as native:
        def accepted(path):
            data = rift.read(path)
            if hashlib.sha256(data).hexdigest() != inventory.get(path):
                raise ValueError('Accepted entry inventory mismatch: ' + path)
            return json.loads(data)

        definitions, locale, role_assets, drop_assets = {}, {}, {}, {}
        for pack in (native, rift):
            for path in pack.namelist():
                if path.endswith('.json') and path.startswith(('Server/NPC/Roles/', 'Server/Drops/')):
                    target = role_assets if path.startswith('Server/NPC/Roles/') else drop_assets
                    target[Path(path).stem] = json.loads(pack.read(path))
                if path.startswith('Server/Item/Items/') and path.endswith('.json'):
                    try:
                        definitions[Path(path).stem] = json.loads(pack.read(path))
                    except (ValueError, UnicodeDecodeError):
                        pass
                if '/en-US/' in path and path.endswith('.lang'):
                    prefix = 'server.' if path.startswith('Server/') else 'common.'
                    for line in pack.read(path).decode('utf-8-sig', errors='replace').splitlines():
                        if '=' in line and not line.lstrip().startswith('#'):
                            key, value = line.split('=', 1)
                            locale[key.strip()] = value.strip()
                            locale.setdefault(prefix + key.strip(), value.strip())

        def definition(item, seen=frozenset()):
            if item in seen or item not in definitions:
                return {}
            raw = definitions[item]
            return {**definition(raw.get('Parent'), seen | {item}), **raw}

        def localize(text, seen=frozenset()):
            if not text or text in seen:
                return ''
            value = locale.get(text, text)
            def embedded(match):
                item = match.group(1)
                key = definition(item).get('TranslationProperties', {}).get('Name', '')
                translated = localize(key, seen | {text})
                return (translated if translated != key else '') or metadata.get(item, {}).get('name', '')
            value = re.sub(r'<item\s+is=["\']([^"\']+)["\']\s*/>', embedded, value)
            # Formatting tags carry no text; unknown semantic tags are omitted
            # conservatively by dropping the whole description below.
            if re.search(r'<(?!/?(?:b|i|color|span|br|bold|italic)\b)[^>]+>', value):
                return ''
            value = re.sub(r'<br\s*/?>', '\n', value)
            value = re.sub(r'<[^>]*>', '', value).replace('\\n', '\n').strip()
            if re.search(r'\b(?:an?|the|at)\s+[.,]|\b(?:at|into)\s+(?:an?|the)\s*[.,]', value):
                return ''
            return value

        def add(item, source=None):
            if not safe(item) or item not in metadata or item not in definitions:
                return False
            entry = output.setdefault(item, {**metadata[item], 'sources': [], 'recipes': []})
            translations = definition(item).get('TranslationProperties', {})
            if translations.get('Name'):
                name = localize(translations['Name'])
                if name and name != translations['Name']:
                    entry['name'] = name
            description = localize(translations.get('Description', ''))
            entry.pop('description', None)
            if description and description != translations.get('Description') and '[TMP]' not in description:
                entry['description'] = description
            if source is not None and source not in entry['sources']:
                entry['sources'].append(source)
            return True

        shops = accepted('merchant-shops.json')
        # Mirror MerchantCatalog.applyTownStockChanges exclusions. Shop entries are
        # explicit purchase routes, unlike unsellable/base-value item inventories.
        for shop in shops['shops']:
            if shop['id'] in {'hunter', 'vox'}:
                continue
            for tab in shop['tabs']:
                if shop['id'] == 'general' and tab['id'] in {'food', 'mounts', 'pets'}:
                    continue
                for entry in tab['entries']:
                    item = entry['itemId']
                    if (item in {'Ingredient_Fabric_Scrap_Wool', 'Ingredient_Bolt_Wool'}
                            or (shop['id'], item) in {
                                ('jewelcrafting', 'Ingredient_Bar_Copper'),
                                ('alchemy', 'Potion_Empty_Small'),
                                ('foraging', 'Ingredient_Stick')}):
                        continue
                    if entry.get('price', 0) <= 0 or entry.get('stock', -1) == 0:
                        continue
                    source = {'type': 'shop', 'shopId': shop['id'], 'shop': shop['name'],
                              'merchant': shop['npcName'], 'quantity': entry['quantity'],
                              'priceGold': entry['price'], 'limitedStock': entry['stock'] > 0}
                    if add(item, source):
                        output[item]['name'] = entry.get('label') or output[item]['name']

        # GuideCatalogLoader.resources supplies these released gathering routes.
        for ore, level, seconds in zip(('Copper', 'Tin', 'Iron', 'Adamantite', 'Mithril', 'Onyxium'), (1, 1, 10, 20, 30, 45), (30, 30, 30, 60, 150, 600)):
            add('Ore_' + ore, {'type': 'gathering', 'profession': 'MINING',
                              'requiredLevel': level, 'respawnSeconds': seconds,
                              'method': f'Mine ore nodes with a pickaxe. Default respawn: {seconds} seconds.'})
        add('Wood_Beech_Trunk', {'type': 'gathering', 'profession': 'FORAGING',
                                'method': 'Chop gatherable beech trees with a hatchet.'})
        add('Ingredient_Tree_Sap', {'type': 'gathering', 'profession': 'FORAGING',
                                    'method': 'Chop gatherable beech trees with a hatchet.'})
        for brush in catalogs['brushes']:
            for reward in brush['rewards']:
                item = next((i for i in reward['itemIdCandidates'] if i in definitions), None)
                if item:
                    add(item, {'type': 'gathering', 'profession': 'FORAGING',
                               'requiredLevel': brush['requiredLevel'],
                               'method': 'Gather ' + brush['displayName'] + '.',
                               'guaranteed': False})
        for index, brush in enumerate(catalogs['brushes']):
            levels = (1, 10, 30, 40, 50)
            for crop in catalogs['farming']:
                if crop['requiredLevel'] == levels[index]:
                    add(crop['seedItemId'], {'type': 'gathering', 'profession': 'FORAGING',
                                           'requiredLevel': brush['requiredLevel'],
                                           'requiredPerk': 'Seed Seeker',
                                           'method': 'Gather ' + brush['displayName'] + ' for a chance of an extra seed with Seed Seeker.',
                                           'guaranteed': False})
        for crop in catalogs['farming']:
            if crop['seedItemId'] in output:
                add(crop['harvestItemId'], {'type': 'farming', 'profession': 'FARMING',
                                           'requiredLevel': crop['requiredLevel'],
                                           'seedItemId': crop['seedItemId'],
                                           'growthMinutes': crop['growTimeMs'] // 60000,
                                           'method': 'Plant the seed in an empty designated farming plot; harvest when ready.'})
        for fish in catalogs['fishing']:
            if 'RiftCore_Fishing_Rod' in output:
                add(fish['itemId'], {'type': 'fishing', 'profession': 'FISHING',
                                     'method': fish['journalClue'], 'guaranteed': False,
                                     'rarity': fish['frequency'].lower()})
                output[fish['itemId']]['rarity'] = fish['frequency'].lower()

        add('Dead_Fish', {'type': 'fishing', 'profession': 'FISHING',
                         'method': 'An occasional failed catch. Becomes less likely as Fishing improves; none at level 60.'})
        bag_materials = {}
        for material in catalogs['bagMaterials']:
            levels = bag_materials.setdefault(material['itemId'], {})
            levels[material['skill']] = min(material['level'], levels.get(material['skill'], material['level']))
        for bag in catalogs['bags']:
            fish = 'Dead Fish' if bag['label'] == 'Junk' else bag['label'] + ' fish'
            add(bag['id'], {'type': 'exchange', 'merchant': 'Rak',
                           'method': f'Trade {bag["cost"]} {fish} for one {bag["label"]} Bag.'})
            for item, requirements in bag_materials.items():
                gem = item.startswith('Rock_Gem_')
                required = ' or '.join(f'{skill.title()} {level}' for skill, level in sorted(requirements.items()))
                add(item, {'type': 'bag', 'bagId': bag['id'],
                    'bagName': bag['label'] + ' Bag', 'requirements': requirements,
                    'minimum': 1 if gem else bag['min'],
                    'maximum': bag['gemMax'] if gem else bag['max'],
                    'method': f'Can contain {1 if gem else bag["min"]}–{bag["gemMax"] if gem else bag["max"]}. Requires {required} when opening. Trade fish with Rak for this bag.'})

        # Only exact roles from the dedicated map's current placement export.
        roles=set(json.loads((SITE/'assets/data/map-npc-roles.json').read_text(encoding='utf-8')))
        assert roles <= role_assets.keys(), 'Placed role missing from accepted/native assets'

        def role_data(role, seen=frozenset()):
            if role in seen or role not in role_assets:
                return {}, {}
            raw = role_assets[role]
            settings, parameters = role_data(raw.get('Reference'), seen | {role})
            parameters = {**parameters, **{k: v.get('Value') for k, v in raw.get('Parameters', {}).items()}}
            return {**settings, **raw, **raw.get('Modify', {})}, parameters

        def drop_items(node, chance=1.0, seen=frozenset()):
            if not isinstance(node, dict):
                return
            if node.get('Type') == 'Single' and node.get('Item', {}).get('ItemId'):
                yield node['Item'], chance
            if node.get('Type') == 'Reference':
                ref = node.get('DropListId') or node.get('DropList')
                if ref in drop_assets and ref not in seen:
                    yield from drop_items(drop_assets[ref].get('Container', {}), chance, seen | {ref})
            children = node.get('Containers', [])
            total = sum(c.get('Weight', 1) for c in children) if node.get('Type') == 'Choice' else 0
            for child in children:
                yield from drop_items(child, chance * child.get('Weight', 1) / total if total else chance, seen)

        def creature_source(role):
            base = re.sub(r'_Level_\d+$', '', role).removeprefix('RiftCore_').removeprefix('Overworld_')
            level = re.search(r'_Level_(\d+)$', role)
            return {'type': 'drop', 'creature': role,
                    'creatureName': base.replace('_', ' ') + (f' (level {level[1]})' if level else '')}

        def drop_counts(node, matches, seen=frozenset()):
            """Exact stack-count distribution; repeated/conditional gem rolls included."""
            kind = node.get('Type')
            if kind == 'Single':
                return {int(matches(node.get('Item', {}).get('ItemId', ''))): 1.0}
            if kind == 'Reference':
                ref = node.get('DropListId') or node.get('DropList')
                if ref in drop_assets and ref not in seen:
                    return drop_counts(drop_assets[ref].get('Container', {}), matches, seen | {ref})
                return {0: 1.0}
            children = node.get('Containers', [])
            if not children:
                return {0: 1.0}
            if kind == 'Choice':
                total = sum(c.get('Weight', 1) for c in children)
                result = {}
                for child in children:
                    for count, chance in drop_counts(child, matches, seen).items():
                        result[count] = result.get(count, 0) + chance * child.get('Weight', 1) / total
                return result
            result = {0: 1.0}
            for child in children:
                combined = {}
                for a, p in result.items():
                    for b, q in drop_counts(child, matches, seen).items():
                        combined[a+b] = combined.get(a+b, 0) + p*q
                result = combined
            return result

        def amount(minimum, maximum):
            return str(minimum) if minimum == maximum else f'{minimum}\u2013{maximum}'

        def shared_bundles(node, chance=1.0):
            children = node.get('Containers', [])
            if node.get('Type') == 'Multiple' and len(children)>1 and chance<1 and all(c.get('Type')=='Single' for c in children):
                yield {'chance':round(chance,10),'items':[c['Item']['ItemId'] for c in children]}
            total = sum(c.get('Weight',1) for c in children) if node.get('Type')=='Choice' else 0
            for child in children:
                yield from shared_bundles(child,chance*child.get('Weight',1)/total if total else chance)

        for role in sorted(roles):
            if '_Quest_' in role:
                continue
            if any(re.fullmatch(re.escape(role) + r'_Level_\d+', other) for other in roles):
                continue
            settings, parameters = role_data(role)
            drop = settings.get('DropList')
            if isinstance(drop, dict):
                drop = parameters.get(drop.get('Compute'))
            container = drop_assets.get(drop, {}).get('Container', {})
            gems = drop_counts(container, lambda item: item.startswith('Rock_Gem_'))
            if max(gems) == 3 and abs(1-gems.get(0, 0)-.1) < 1e-8:
                creature_loot[role] = {'gemChain': {'chance': .1, 'maximum': 3,
                    'repeatChance': .1, 'twoOrMore': .01, 'three': .001}}
            bundles=list(shared_bundles(container))
            if bundles:
                creature_loot.setdefault(role,{})['bundles']=bundles
            # No stale guide lookup fallback: effective role/drop assets decide rewards.
            rewards = {}
            for reward, chance in drop_items(drop_assets.get(drop, {}).get('Container', {})):
                item = reward['ItemId']
                if item not in rewards:
                    rewards[item] = [reward.get('QuantityMin', 1), reward.get('QuantityMax', 1), chance]
                else:
                    rewards[item][0] = min(rewards[item][0], reward.get('QuantityMin', 1))
                    rewards[item][1] = max(rewards[item][1], reward.get('QuantityMax', 1))
                    rewards[item][2] += chance
            for item, (minimum, maximum, chance) in rewards.items():
                chance = 1-drop_counts(container, lambda value: value == item).get(0, 0)
                add(item, {**creature_source(role), 'guaranteed': chance >= 0.999999,
                           'dropChance': round(chance, 10),
                           'method': f'{"Drops" if chance >= 0.999999 else "Can drop"} {amount(minimum,maximum)} {"per kill" if chance >= 0.999999 else "at a time"}.'})

        boss_loot = accepted('variant-loot/wild-bosses.json')
        for boss in boss_loot['bosses']:
            if boss['role'] not in roles:
                continue
            source = creature_source(boss['role'])
            categories = boss.get('categories') or boss_loot['categories']
            weights = {c['value']: c['weight']/sum(v['weight'] for v in categories) for c in categories}
            rolls = boss_loot['rollsPerKill']
            creature_loot[boss['role']] = {'guaranteedGems': True}
            for material in boss['materials']:
                single = weights.get('material',0)*material['weight']/sum(m['weight'] for m in boss['materials'])
                add(material['itemId'], {**source, 'guaranteed': False,
                    'dropChance': round(1-(1-single)**rolls,10),
                    'method': f'Can drop {amount(material["minimum"],material["maximum"])} in a material reward roll.'})
            for gem in boss['gems']:
                tiers = boss.get('gemTiers') or [{'value': '', 'weight':1}]
                for tier in tiers:
                    single = tier['weight']/sum(t['weight'] for t in tiers)/len(boss['gems'])
                    add(gem + tier['value'], {**source, 'guaranteed': False,
                        'dropChance': round(1-(1-single)*(1-weights.get('gem',0)*single)**rolls,10),
                        'method': 'Every kill awards an extra stack of 1–3 gems, chosen from this boss’s gem pool. Existing reward rolls can award more.'})
            if boss.get('bonusDrop'):
                add(boss['bonusDrop']['itemId'], {**source, 'guaranteed': False,
                    'dropChance': 1/boss['bonusDrop']['oneIn'],
                    'method': f'Rare mount reward: 1 in {boss["bonusDrop"]["oneIn"]:,} kills.'})

        # Active released forge families are authoritative overrides, not every
        # native item's embedded recipe. Merge in the same order as the loader.
        for path in ('defaults/content/gear_v2_recipes.json',
                     'defaults/content/hope_weapon_recipes.json',
                     'defaults/content/fist_weapon_recipes.json',
                     'defaults/content/druid_staff_recipes.json'):
            for recipe in accepted(path)['recipes']:
                if visible(recipe):
                    if recipe['outputId'] == 'Ingredient_Bolt_Cotton':
                        recipe['inputs'] = [{'acceptedItemIds': ['Ingredient_Fibre', 'Ingredient_Fabric_Scrap_Cotton'], 'quantity': i['quantity']}
                                            if i.get('itemId') == 'Ingredient_Fibre' else i for i in recipe['inputs']]
                    recipe_for(recipe['outputId'], {
                        'bench': recipe['benchId'], 'profession': recipe['skill'],
                        'requiredLevel': recipe['requiredLevel'],
                        'quantity': recipe.get('outputQty', 1),
                        'inputs': recipe['inputs']})

        for recipe in catalogs['alchemy']:
            recipe_for(recipe['outputItemId'], {'bench': 'Alchemy Bench', 'profession': 'ALCHEMY',
                        'requiredLevel': recipe['requiredLevel'], 'quantity': recipe['outputQty'],
                        'inputs': recipe['inputs'], 'goldCost': recipe['goldCost']})
        for recipe in catalogs['cooking']:
            inputs = [{'acceptedItemIds': i['acceptedItemIds'], 'quantity': i['quantity']}
                      for i in recipe['inputs']]
            recipe_for(recipe['outputItemId'], {'bench': 'Cooking station', 'profession': 'COOKING',
                        'requiredLevel': recipe['requiredLevel'], 'quantity': recipe['outputQty'],
                        'inputs': inputs})
        for recipe in catalogs['bands']:
            recipe_for(recipe['outputItemId'], {'bench': 'Jewelcrafting station',
                        'profession': 'JEWELCRAFTING', 'requiredLevel': recipe['requiredLevel'],
                        'quantity': 1, 'inputs': [{'itemId': 'Ingredient_Bar_' + recipe['metal'].title(),
                                                 'quantity': recipe['barCost']}]})
        gems = {g['key']: g['itemId'] for g in catalogs['gems']}
        for recipe in catalogs['sockets']:
            recipe_for(recipe['outputItemId'], {'bench': 'Jewelcrafting station',
                        'profession': 'JEWELCRAFTING', 'requiredLevel': recipe['requiredLevel'],
                        'quantity': 1, 'inputs': [{'itemId': recipe['bandItemId'], 'quantity': 1}]
                           + [{'itemId': gems[key], 'quantity': 1} for key in recipe['gemKeys']]})
        for recipe in catalogs['refining']:
            recipe_for(recipe['outputItemId'], {'bench': 'Jewelcrafting station',
                        'profession': 'JEWELCRAFTING', 'requiredLevel': recipe['requiredLevel'],
                        'quantity': recipe['outputQuantity'],
                        'inputs': [{'itemId': recipe['inputItemId'], 'quantity': recipe['inputQuantity']}]})

        # Narrow processing coverage: released ore-to-bar recipes. Require a
        # known bar progression level and an exact furnace, never arbitrary assets.
        for item, raw in definitions.items():
            leather = item.removeprefix('Ingredient_Leather_')
            if item.startswith('Ingredient_Leather_') and leather in {'Soft','Light','Medium','Scaled','Dark','Storm','Heavy','Prismic'}:
                recipe = raw.get('Recipe', {})
                if any(b.get('Id') == 'Tannery' for b in recipe.get('BenchRequirement', [])):
                    recipe_for(item, {'bench': 'Tannery', 'profession': 'LEATHERWORKING',
                        'requiredLevel': {'Soft':1,'Light':12,'Medium':24,'Scaled':24,'Dark':36,'Storm':36,'Heavy':48,'Prismic':48}[leather],
                        'quantity': recipe.get('OutputQuantity', 1),
                        'inputs': [{'itemId': i['ItemId'], 'quantity': i.get('Quantity', 1)} for i in recipe.get('Input', [])]})
            metal = item.removeprefix('Ingredient_Bar_')
            if not item.startswith('Ingredient_Bar_') or metal not in BAR_LEVELS:
                continue
            recipe = raw.get('Recipe', {})
            if not any(b.get('Id') == 'Furnace' for b in recipe.get('BenchRequirement', [])):
                continue
            inputs = [{'itemId': i['ItemId'], 'quantity': i.get('Quantity', 1)}
                      for i in recipe.get('Input', []) if i.get('ItemId')]
            if inputs and len(inputs) == len(recipe.get('Input', [])):
                recipe_for(item, {'bench': 'Furnace', 'profession': 'SMITHING',
                                    'requiredLevel': BAR_LEVELS[metal],
                                    'quantity': recipe.get('OutputQuantity', 1),
                                    'inputs': inputs, 'requiresFuel': True})

        # Least fixed point: cycles and inaccessible inputs never gain admission.
        def obtainable(inputs):
            return bool(inputs) and all(
                i.get('quantity', 0) > 0 and
                (any(a in output for a in i['acceptedItemIds']) if 'acceptedItemIds' in i else
                 i.get('itemId') in output if i.get('itemId') else
                 i.get('resourceTypeId') == 'Wood_Trunk' and 'Wood_Beech_Trunk' in output)
                for i in inputs)

        changed = True
        while changed:
            changed = False
            for item, recipes in candidates.items():
                if item not in output and any(obtainable(r['inputs']) for r in recipes) and add(item):
                    changed = True
        for item, recipes in candidates.items():
            for recipe in recipes:
                if item in output and obtainable(recipe['inputs']):
                    inputs = []
                    for ingredient in recipe['inputs']:
                        value = dict(ingredient)
                        if 'acceptedItemIds' in value:
                            value['acceptedItemIds'] = [i for i in value['acceptedItemIds'] if i in output]
                            value['itemId'] = value['acceptedItemIds'][0]
                        inputs.append(value)
                    output[item]['recipes'].append({**recipe, 'inputs': inputs})
                    source = {'type': 'crafting', 'bench': recipe['bench'],
                              'profession': recipe['profession'], 'requiredLevel': recipe['requiredLevel']}
                    if source not in output[item]['sources']:
                        output[item]['sources'].append(source)
        progression = accepted('gear-progression-v2.json')['items']
        for item, entry in output.items():
            if item in progression:
                gear = progression[item]
                entry['name'] = gear.get('name') or entry['name']
                entry['requiredLevel'] = gear['level']
                if gear.get('armorType'):
                    entry['armorType'] = gear['armorType']
        for entry in output.values():
            order = {'shop':0, 'gathering':1, 'farming':2, 'fishing':3, 'drop':4, 'exchange':5, 'bag':6, 'crafting':7}
            entry['sources'].sort(key=lambda s: (order.get(s['type'], 9), s.get('shop', ''), s.get('creature', '')))
        for metal in ('Copper', 'Tin', 'Iron', 'Adamantite', 'Mithril', 'Onyxium'):
            if 'Ore_' + metal in output:
                output['Ore_' + metal]['description'] = (f'Smelt this ore into {metal} bars at a furnace.'
                    if 'Ingredient_Bar_' + metal in output else 'Gather this ore with a pickaxe.')

    result = {'schemaVersion': 1, 'releaseVersion': receipt['version'],
              'snapshotKind': 'accepted-release-defaults',
              'items': dict(sorted(output.items())), 'creatures': creature_loot,
              'coverage': {'items': len(output),
                           'recipeItems': sum(bool(e['recipes']) for e in output.values()),
                           'limitations': ['Live merchant stock and custom server overrides are not included.',
                                           'Dynamic equipment rolls and meal metadata variants are not included.',
                                           'Recipes with unverified ingredient routes are excluded.']}}
    destination = SITE / 'assets/data/discovery-items.json'
    destination.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n',
                           encoding='utf-8')
    print(json.dumps(result['coverage']))


if __name__ == '__main__':
    build()
