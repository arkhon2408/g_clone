'use strict';
// ---------------------------------------------------------------------------
// test.js — automated gameplay smoke test. Inert unless the page is loaded
// with ?autotest. Drives the real game systems and prints PASS/FAIL on-page.
// ---------------------------------------------------------------------------

// ?dlgshot — start the game with Diego's dialog open (visual layout check)
if (window.location.search.indexOf('dlgshot') >= 0) {
  window.addEventListener('DOMContentLoaded', function() {
    startGame();
    openDialog(GAME.npcs.filter(function(n) { return n.dialog === 'diego'; })[0]);
  });
}

// ?invshot — start the game with the inventory open (visual layout check)
if (window.location.search.indexOf('invshot') >= 0) {
  window.addEventListener('DOMContentLoaded', function() {
    startGame();
    toggleInventory();
  });
}

// ?chrshot — start the game with the character screen open (visual layout check)
if (window.location.search.indexOf('chrshot') >= 0) {
  window.addEventListener('DOMContentLoaded', function() {
    startGame();
    toggleCharacter();
  });
}

// ?oreshot — start at the ore vein with a lit torch (visual check: node meshes,
// wolves, torch light)
if (window.location.search.indexOf('oreshot') >= 0) {
  window.addEventListener('DOMContentLoaded', function() {
    startGame();
    const p = GAME.player;
    const vein = WORLD.nodes.filter(function(n) { return n.kind === 'ore'; })[0];
    p.items['Torch'] = 1;
    p.torchLit = true;
    p.maxhp = 5000; // the wolves WILL come for the photographer
    p.hp = 5000;
    p.pos.x = vein.x + 4.5;
    p.pos.z = vein.z + 4.5;
    p.pos.y = terrainH(p.pos.x, p.pos.z);
    p.yaw = Math.atan2(vein.x - p.pos.x, vein.z - p.pos.z) + 0.35;
    p.pitch = -0.15;
    GAME.timeOfDay = 0.93; // night — let the ore and the torch glow
  });
}

// ?mpshot — multiplayer visual check: starts the game and delays the window
// load event (via the server's /wait endpoint) so a headless screenshot is
// taken only after the websocket session is established.
if (window.location.search.indexOf('mpshot') >= 0) {
  window.addEventListener('DOMContentLoaded', function() {
    startGame(true);
    const m = /[?&]server=([^&]+)/.exec(window.location.search);
    if (m) {
      const httpUrl = decodeURIComponent(m[1]).replace(/^ws/, 'http');
      const img = new Image();
      img.src = httpUrl + '/wait';
      img.style.display = 'none';
      document.body.appendChild(img);
    }
  });
}

// ?fbshot — open the feedback panel on the title screen; with ?server= it
// fills the form and actually sends, so the screenshot shows the result
if (window.location.search.indexOf('fbshot') >= 0) {
  window.addEventListener('DOMContentLoaded', function() {
    openFeedback();
    const m = /[?&]server=([^&]+)/.exec(window.location.search);
    if (m) {
      NET.url = decodeURIComponent(m[1]);
      document.getElementById('fbName').value = 'TestScribe';
      document.getElementById('fbText').value = 'Sent from the fbshot harness.';
      sendFeedback();
    }
  });
}

if (window.location.search.indexOf('autotest') >= 0) {
  window.addEventListener('DOMContentLoaded', function() {
    const out = [];
    let failures = 0;
    function check(name, cond) {
      out.push((cond ? 'PASS  ' : 'FAIL  ') + name);
      if (!cond) failures++;
    }
    function sim(seconds, input) {
      const steps = Math.ceil(seconds * 60);
      for (let i = 0; i < steps; i++) updateGame(1 / 60, input || {});
    }

    startGame();
    const p = GAME.player;

    // 1. spawn / physics sanity
    sim(0.5);
    check('player stands on terrain', Math.abs(p.pos.y - terrainH(p.pos.x, p.pos.z)) < 0.05);
    check('npcs spawned', GAME.npcs.length >= 16);

    // 2. movement + palisade wall blocks entry outside the gate
    p.pos.x = 20; p.pos.z = 42; // outside the wall, north-east-ish of gate
    sim(3, { KeyW: true });     // yaw still PI -> walking toward -Z, into the ring
    check('palisade blocks walking through', Math.hypot(p.pos.x, p.pos.z) > WORLD.campR - 1.2);
    p.pos.x = 0; p.pos.z = 60; p.yaw = Math.PI;
    sim(5, { KeyW: true });
    check('gate lets the player in', Math.hypot(p.pos.x, p.pos.z) < WORLD.campR);

    // 3. dialogue: accept Diego's quest, receive the blade
    const diego = GAME.npcs.filter(function(n) { return n.dialog === 'diego'; })[0];
    p.pos.x = diego.pos.x; p.pos.z = diego.pos.z + 1.5;
    openDialog(diego);
    check('dialog opened', GAME.uiOpen === 'dialog' && UI.currentOpts.length >= 4);
    const offerOpt = UI.currentOpts.filter(function(o) { return o.next === 'offer'; })[0];
    check('quest offer present', !!offerOpt);
    pickDialogOption(offerOpt);
    pickDialogOption(UI.currentOpts[0]); // "Consider it done."
    check('dialog closed after accepting', GAME.uiOpen === null);
    check('quest active', GAME.quest.molerats === 'active');
    check('sword received', p.hasSword === true && p.weaponDmg === 18);

    // 4. combat: kill a molerat with real swings + real frames
    const rat = GAME.npcs.filter(function(n) { return n.kind === 'molerat'; })[0];
    p.pos.x = rat.pos.x; p.pos.z = rat.pos.z + 1.6;
    p.pos.y = terrainH(p.pos.x, p.pos.z);
    p.yaw = Math.atan2(rat.pos.x - p.pos.x, rat.pos.z - p.pos.z);
    p.hp = p.maxhp;
    let guard = 0;
    while (rat.state !== 'dead' && guard++ < 40) {
      p.yaw = Math.atan2(rat.pos.x - p.pos.x, rat.pos.z - p.pos.z);
      playerSwing();
      sim(1);
    }
    check('molerat killed by swings', rat.state === 'dead');
    check('kill counted for quest', GAME.quest.kills >= 1);
    check('molerat meat looted', (p.items['Molerat meat'] || 0) >= 1);
    check('xp awarded', p.xp > 0 || p.level > 1);

    // 5. eating heals
    p.hp = 40;
    eatItem('Molerat meat');
    check('eating molerat meat heals 20', p.hp === 60);

    // 6. trading with Whistler
    p.ore = 25;
    const buyNode = DIALOGS.whistler.trade(null);
    buyNode.opts[0].fn();
    check('bought dried meat for 10 ore', p.ore === 15 && (p.items['Dried meat'] || 0) >= 2);
    buyNode.opts[0].fn();
    p.ore = 3;
    buyNode.opts[0].fn(); // too poor — must not go negative
    check('cannot buy without ore', p.ore === 3);

    // 6c. tools, the torch, and gathering
    function opt(node, sub) {
      return node.opts.filter(function(o) { return o.t.indexOf(sub) >= 0; })[0];
    }
    p.ore = 300;
    const toolsNode = DIALOGS.whistler.tools(null);
    opt(toolsNode, 'pickaxe').fn();
    opt(toolsNode, 'woodcutter').fn();
    opt(toolsNode, 'torch').fn();
    check('bought pickaxe, axe and torch', p.items['Pickaxe'] === 1
          && p.items['Woodcutter\'s axe'] === 1 && p.items['Torch'] === 1 && p.ore === 215);
    opt(DIALOGS.whistler.tools(null), 'pickaxe').fn();
    check('cannot buy a second pickaxe', p.ore === 215);
    toggleTorch();
    check('torch lights', p.torchLit === true);
    toggleTorch();

    const treeCount = WORLD.nodes.filter(function(n) { return n.kind === 'tree'; }).length;
    const rockCount = WORLD.nodes.filter(function(n) { return n.kind === 'stone'; }).length;
    check('every tree and rock is harvestable', treeCount >= 100 && rockCount >= 25);
    // chop a tree that no hostile is camping next to
    const pine = WORLD.nodes.filter(function(n) {
      return n.kind === 'tree' && GAME.npcs.every(function(h) {
        return !h.hostile || Math.hypot(h.pos.x - n.x, h.pos.z - n.z) > 25;
      });
    })[0];
    p.pos.x = pine.x; p.pos.z = pine.z + 1.8;
    p.pos.y = terrainH(p.pos.x, p.pos.z);
    p.yaw = Math.atan2(pine.x - p.pos.x, pine.z - p.pos.z);
    let g2 = 0;
    while (pine.alive && g2++ < 8) { playerSwing(); sim(1); }
    check('tree chopped for wood', !pine.alive && (p.items['Wood'] || 0) >= 3);
    pine.respawnT = 0.5;
    sim(1);
    check('nodes respawn', pine.alive && pine.hits === pine.maxHits);

    const vein = WORLD.nodes.filter(function(n) { return n.kind === 'ore'; })[0];
    const wolves = GAME.npcs.filter(function(n) { return n.kind === 'wolf'; });
    check('wolves guard the ore vein', wolves.length === 3 && wolves.every(function(w) {
      return Math.hypot(w.pos.x - vein.x, w.pos.z - vein.z) < 18;
    }));
    for (const w of wolves) { w.state = 'dead'; w.respawnT = 999; } // clear the way
    p.pos.x = vein.x; p.pos.z = vein.z + 1.9;
    p.pos.y = terrainH(p.pos.x, p.pos.z);
    p.yaw = Math.atan2(vein.x - p.pos.x, vein.z - p.pos.z);
    g2 = 0;
    while (vein.alive && g2++ < 10) { playerSwing(); sim(1); }
    check('ore vein mined', !vein.alive && (p.items['Raw ore'] || 0) >= 4);

    // 6d. selling, the stock cap, and the smelter
    p.items['Wood'] = 10;
    MERCHANT.stock['Wood'] = 0;
    const oreBeforeSell = p.ore;
    opt(DIALOGS.whistler.sell(null), 'wood').fn();
    check('sold wood to Whistler', p.items['Wood'] === 0 && MERCHANT.stock['Wood'] === 10
          && p.ore === oreBeforeSell + 40);
    p.items['Wood'] = 5;
    MERCHANT.stock['Wood'] = MERCHANT.cap['Wood'];
    const oreAtCap = p.ore;
    opt(DIALOGS.whistler.sell(null), 'wood').fn();
    check('full stock blocks selling', p.items['Wood'] === 5 && p.ore === oreAtCap);
    const stockBefore = MERCHANT.stock['Wood'];
    const smeltBefore = MERCHANT.smelted;
    updateMerchant(17);
    check('smelter converts stock to ore', MERCHANT.stock['Wood'] === stockBefore - 2
          && MERCHANT.smelted > smeltBefore);

    // 6e. potions and weapon upgrades
    MERCHANT.stock['Health potion'] = 2;
    p.ore = 100;
    opt(DIALOGS.whistler.trade(null), 'potion').fn();
    check('bought a health potion', (p.items['Health potion'] || 0) >= 1 && p.ore === 75);
    p.hp = 30;
    eatItem('Health potion');
    check('potion heals 50', p.hp === 80);
    p.ore = 400;
    opt(DIALOGS.whistler.weapons(null), 'ore blade').fn();
    check('ore blade bought and equipped', p.weaponName === 'Ore blade'
          && p.weaponDmg === 40 && p.items['Ore blade'] === 1);
    equipWeapon('Old Camp blade');
    check('weapons swap from the inventory', p.weaponName === 'Old Camp blade'
          && p.weaponDmg === 18);
    equipWeapon('Ore blade');

    // 6f. Snaf's one soup per day
    const soupNode1 = DIALOGS.snaf.main(null);
    check('Snaf offers the daily soup', !!opt(soupNode1, 'ladle'));
    opt(soupNode1, 'ladle').fn();
    check('soup received', (p.items['Molerat soup'] || 0) === 1
          && GAME.lastSoupDay === GAME.day);
    check('no second soup today', !opt(DIALOGS.snaf.main(null), 'ladle'));
    GAME.day++;
    check('a new day, a new soup', !!opt(DIALOGS.snaf.main(null), 'ladle'));
    GAME.day--;
    p.hp = 50;
    eatItem('Molerat soup');
    check('soup heals 40', p.hp === 90);

    // 6b. character screen opens and closes
    toggleCharacter();
    check('character screen opens', GAME.uiOpen === 'character'
          && UI.chrList.children.length >= 9);
    toggleCharacter();
    check('character screen closes', GAME.uiOpen === null);
    check('kills are tracked', GAME.kills >= 1);

    // 7. friendly NPCs cannot be hurt
    const guardNpc = GAME.npcs.filter(function(n) { return n.dialog === 'guard'; })[0];
    damageNPC(guardNpc, 999);
    check('camp guards are protected', guardNpc.state !== 'dead' && guardNpc.hp === guardNpc.maxhp);

    // 8. death + respawn
    damagePlayer(9999, 'the test harness');
    check('death screen shows', GAME.uiOpen === 'death' && p.hp === 0);
    respawn();
    check('respawn restores the player', p.hp > 0 && GAME.uiOpen === null
          && Math.hypot(p.pos.x, p.pos.z - 60) < 1);

    // 9. quest completion pays out
    GAME.quest.kills = 5;
    const oreBefore = p.ore;
    DIALOGS.diego.reward(diego).opts[0].fn();
    check('reward pays 50 ore', GAME.quest.molerats === 'rewarded' && p.ore === oreBefore + 50);

    // 10. a hostile NPC actually fights back
    const bandit = GAME.npcs.filter(function(n) { return n.name === 'Bandit'; })[0];
    p.pos.x = bandit.pos.x + 1.2; p.pos.z = bandit.pos.z;
    p.pos.y = terrainH(p.pos.x, p.pos.z);
    p.hp = p.maxhp;
    sim(6);
    check('bandit aggroes and damages the player', p.hp < p.maxhp);

    // 10b. the rich vein is guarded by something far worse
    const vein2 = WORLD.nodes.filter(function(n) { return n.kind === 'ore'; })[1];
    const beasts = GAME.npcs.filter(function(n) { return n.kind === 'shadowbeast'; });
    check('shadowbeasts guard the rich vein', beasts.length === 2 && vein2.mult === 2
          && beasts.every(function(b) {
               return Math.hypot(b.pos.x - vein2.x, b.pos.z - vein2.z) < 18;
             }));
    p.pos.x = vein2.x; p.pos.z = vein2.z;
    p.pos.y = terrainH(p.pos.x, p.pos.z);
    p.hp = p.maxhp; // an underleveled digger stands no chance here
    sim(12);
    check('shadowbeasts kill the underleveled', p.hp === 0 && GAME.uiOpen === 'death');
    respawn();

    // 11. clock advances
    const todBefore = GAME.timeOfDay;
    sim(2);
    check('day/night clock advances', GAME.timeOfDay > todBefore);

    const box = document.getElementById('errbox');
    box.style.display = 'block';
    box.style.background = failures ? '#4a0a0a' : '#0a3a14';
    box.textContent = 'AUTOTEST  ' + (out.length - failures) + '/' + out.length
                    + (failures ? '  — FAILURES BELOW\n' : '  — ALL PASS\n')
                    + out.join('\n');
  });
}
