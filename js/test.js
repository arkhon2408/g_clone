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

// ?mpshot — multiplayer visual check: starts the game and delays the window
// load event (via the server's /wait endpoint) so a headless screenshot is
// taken only after the websocket session is established.
if (window.location.search.indexOf('mpshot') >= 0) {
  window.addEventListener('DOMContentLoaded', function() {
    startGame();
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
