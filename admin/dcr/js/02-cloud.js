/*
 * 02-cloud.js
 * Phase A refactor: extracted verbatim from index.html.
 * Supabase cloud sync — auth, RLS-aware push/pull, realtime (block #1)
 *
 * Phase B notes:
 *   - Convert to ES module: replace globals with explicit import/export.
 *   - Pure functions (no DOM) → keep / move to js/engine/.
 *   - Render functions (touch DOM) → keep in this layer; become components later.
 */

(function(){
  // ---- Environment switching: prod = www.abhinayacinemas.com only;
  //      every other hostname (netlify.app, branch deploys, localhost) = STAGING.
  //      The staging Supabase project is fully separate — schema migrations and
  //      bad data in staging can never touch live data.
  var PROD = {
    url:  'https://xkmjygegtpmmwwnyoufn.supabase.co',
    anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrbWp5Z2VndHBtbXd3bnlvdWZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODI2NTEsImV4cCI6MjA5NTQ1ODY1MX0.ILYBoN4OqFGIatTCTJ3hhfbGj6n8Q6e5LAhOVDDuTgo'
  };
  var STAGING = {
    // >>> Paste the staging Supabase Project URL + anon key here once the
    //     'Abhinaya DCR Staging' project is created. Leave the placeholders
    //     unchanged until then — the tool will show a clear setup notice
    //     on staging URLs instead of trying to connect.
    url:  'https://lctkvmpzijaspaytunkm.supabase.co',
    anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjdGt2bXB6aWphc3BheXR1bmttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTU0NDgsImV4cCI6MjA5NTYzMTQ0OH0.YeYegXQvX0l0FMABDgljs_bV_t9C66x77Y3kj2YZ55A'
  };

  // Treat the URL as STAGING only if the hostname explicitly signals it
  // (Netlify branch deploys are 'staging--<site>.netlify.app'; PR previews are
  // 'deploy-preview-N--<site>.netlify.app'). Everything else — the custom
  // domain AND the bare netlify.app default URL — is prod.
  // Any branch deploy or PR preview on netlify.app is staging (hostnames look like
  // 'staging-refactor--<site>.netlify.app' or 'deploy-preview-N--<site>.netlify.app').
  // The bare site URL '<site>.netlify.app' has no '--' and is therefore prod.
  var IS_STAGING = (location.hostname.endsWith('.netlify.app') && location.hostname.includes('--')) ||
                   location.hostname === 'localhost' ||
                   location.hostname === '127.0.0.1';
  var IS_PROD = !IS_STAGING;
  var ENV = IS_PROD ? PROD : STAGING;
  window.__DCR_ENV = IS_PROD ? 'prod' : 'staging';

  // Friendly setup notice when staging keys haven't been filled in yet
  function setupNoticeStaging(){
    var ov = document.createElement('div');
    ov.id='cloudGate';
    ov.style.cssText='position:fixed;inset:0;z-index:99999;background:#181818;color:#fff;display:flex;align-items:center;justify-content:center;font-family:\'Barlow Semi Condensed\',system-ui,sans-serif;text-align:center;padding:24px';
    ov.innerHTML='<div style="max-width:520px">'+
      '<div style="display:inline-block;background:#F7B61F;color:#181818;padding:4px 10px;border-radius:4px;font-weight:700;letter-spacing:.08em;font-size:12px;margin-bottom:18px">STAGING</div>'+
      '<h2 style="margin:0 0 12px;font-size:22px">Test environment is not configured yet</h2>'+
      '<p style="opacity:.8;font-size:14px;line-height:1.5">This is the staging URL ('+location.hostname+'). The owner needs to create the staging Supabase project and paste its URL + anon key into <code>admin/dcr/index.html</code> before this site can connect.</p>'+
      '<p style="opacity:.6;font-size:12.5px;margin-top:14px">Production users: please visit <a href="https://www.abhinayacinemas.com/admin/dcr/" style="color:#F7B61F">www.abhinayacinemas.com/admin/dcr/</a> instead.</p>'+
      '</div>';
    document.body.appendChild(ov);
  }
  if(!IS_PROD && ENV.url.indexOf('PASTE_STAGING') === 0){
    setupNoticeStaging();
    return;
  }

  if(!window.supabase || !window.supabase.createClient){
    console.error('Supabase library did not load (need internet).');
    return;
  }
  var sb = window.supabase.createClient(ENV.url, ENV.anon, {
    auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
  });
  window._sb = sb;

  // Persistent banner so anyone using staging can never confuse it with prod
  if(!IS_PROD){
    var b=document.createElement('div');
    b.id='envBanner';
    b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9998;background:#F7B61F;color:#181818;font-family:\'Barlow Semi Condensed\',system-ui,sans-serif;font-weight:700;letter-spacing:.06em;font-size:12.5px;text-align:center;padding:5px 8px;box-shadow:0 1px 2px rgba(0,0,0,.18)';
    b.innerHTML='● TEST ENVIRONMENT — changes here do NOT affect live data ('+location.hostname+')';
    document.body.appendChild(b);
    // push the page down so the banner doesn't overlap the logo
    document.body.style.paddingTop='28px';
  }

  var ME=null, ROLE=null, READY=false, booting=false;
  var pushTimer=null, pullTimer=null;
  var synced={ cfg:null, ent:{} };

  var CFG_KEYS=['cinema','tax','classes','screens','movies','serialStarts','openings'];
  function cfgObj(){ var o={}; CFG_KEYS.forEach(function(k){ o[k]=S[k]; }); return o; }
  function entKey(e){ return (e.date||'')+'|'+e.movieId+'|'+e.screenId; }
  function entSig(e){ return JSON.stringify({share:e.share, shows:e.shows||[]}); }

  // ---------- gate overlay ----------
  function overlay(html){
    var ov=document.getElementById('cloudGate');
    if(!ov){
      ov=document.createElement('div'); ov.id='cloudGate';
      ov.style.cssText='position:fixed;inset:0;z-index:99999;background:#181818;color:#fff;display:flex;align-items:center;justify-content:center;font-family:\'Barlow Semi Condensed\',system-ui,sans-serif;text-align:center;padding:24px';
      document.body.appendChild(ov);
    }
    ov.innerHTML='<div style="max-width:400px">'+html+'</div>';
    ov.style.display='flex';
  }
  function hideOverlay(){ var ov=document.getElementById('cloudGate'); if(ov) ov.style.display='none'; }

  function loginScreen(msg){
    overlay(
      '<div style="display:flex;gap:6px;justify-content:center;margin-bottom:18px">'+
        '<i style="width:11px;height:36px;background:#F93820;display:inline-block;border-radius:1px"></i>'+
        '<i style="width:11px;height:36px;background:#F7B61F;display:inline-block;border-radius:1px"></i>'+
        '<i style="width:11px;height:36px;background:#3488C0;display:inline-block;border-radius:1px"></i>'+
      '</div>'+
      '<h1 style="font-size:27px;letter-spacing:.04em;margin:0 0 4px;font-weight:800">ABHINAYA CINEMAS</h1>'+
      '<p style="opacity:.65;margin:0 0 28px;font-size:15px;letter-spacing:.02em">Daily Collection Report</p>'+
      (msg ? '<p style="color:#F7B61F;margin:0 0 20px;font-size:14px;line-height:1.4">'+msg+'</p>' : '')+
      '<button id="gBtn" style="background:#fff;color:#181818;border:0;border-radius:9px;padding:13px 24px;font-size:15px;font-weight:600;cursor:pointer">Sign in with Google</button>'
    );
    var b=document.getElementById('gBtn');
    if(b) b.onclick=function(){
      sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: IS_PROD ? 'https://www.abhinayacinemas.com/admin/dcr/' : (location.origin + location.pathname) } });
    };
  }

  // ---------- auth / authorization ----------
  function checkAuthorized(){
    return sb.auth.getUser().then(function(res){
      var user = res && res.data && res.data.user;
      if(!user){ ME=null; return null; }
      ME=(user.email||'').toLowerCase();
      return sb.from('authorized_users').select('email,role,full_name').eq('email',ME).maybeSingle()
        .then(function(r){
          if(r.error){ console.error(r.error); }
          if(r.data){
            ROLE=r.data.role;
            window.__DCR_ROLE = ROLE;
            try{ document.body.classList.toggle('role-accountant', ROLE==='accountant'); }catch(_){}
            return r.data;
          }
          return null;
        });
    });
  }

  // ---------- pull everything from cloud into S ----------
  function pullAll(){
    return Promise.all([
      sb.from('config').select('data').eq('id',1).maybeSingle(),
      sb.from('entries').select('*')
    ]).then(function(out){
      var cfg = out[0] && out[0].data;
      var rows = (out[1] && out[1].data) || [];
      var draft = S.draft;
      if(cfg && cfg.data && Object.keys(cfg.data).length){
        CFG_KEYS.forEach(function(k){ if(cfg.data[k]!==undefined) S[k]=cfg.data[k]; });
      }
      S.entries = rows.map(function(r){
        return { id:uid(), date:r.entry_date, movieId:r.movie_id, screenId:r.screen_id, share:r.share, shows:r.shows||[] };
      });
      S = normalize(S); S.draft = draft;
      synced.cfg = JSON.stringify(cfgObj());
      synced.ent = {};
      S.entries.forEach(function(e){ synced.ent[entKey(e)] = entSig(e); });
      try{ localStorage.setItem(LS_KEY, JSON.stringify(S)); }catch(e){}
    }).catch(function(e){ console.error('Cloud pull failed', e); });
  }

  // ---------- push only what changed ----------
  function pushDeltas(){
    if(!READY) return;
    if(ROLE==='accountant'){ bar('saved'); return; }
    var ops=[];
    if(ROLE==='owner'){
      var cur=JSON.stringify(cfgObj());
      if(cur!==synced.cfg){
        ops.push(
          sb.from('config').upsert({ id:1, data:cfgObj(), updated_by:ME, updated_at:new Date().toISOString() })
            .then(function(r){ if(r.error) console.error(r.error); else synced.cfg=cur; })
        );
      }
    }
    var curKeys={};
    S.entries.forEach(function(e){
      var k=entKey(e), sig=entSig(e); curKeys[k]=true;
      if(synced.ent[k]!==sig){
        ops.push(
          sb.from('entries').upsert(
            { entry_date:e.date, movie_id:e.movieId, screen_id:e.screenId,
              share:(e.share===''||e.share==null)?null:e.share, shows:e.shows||[],
              updated_by:ME, updated_at:new Date().toISOString() },
            { onConflict:'entry_date,movie_id,screen_id' }
          ).then(function(r){ if(r.error) console.error(r.error); else synced.ent[k]=sig; })
        );
      }
    });
    Object.keys(synced.ent).forEach(function(k){
      if(!curKeys[k]){
        var parts=k.split('|');
        ops.push(
          sb.from('entries').delete().match({ entry_date:parts[0], movie_id:parts[1], screen_id:parts[2] })
            .then(function(r){ if(r.error) console.error(r.error); else delete synced.ent[k]; })
        );
      }
    });
    if(!ops.length){ bar('saved'); return; }
    Promise.all(ops).then(function(){ bar('saved'); }).catch(function(e){ console.error(e); bar('error'); });
  }

  // hook invoked by the app's save()
  window.cloudOnSave=function(){
    if(!READY) return;
    bar('saving');
    clearTimeout(pushTimer);
    pushTimer=setTimeout(pushDeltas, 900);
  };

  // ---------- realtime: pull when someone else changes data ----------
  function subscribe(){
    try{
      sb.channel('dcr-sync')
        .on('postgres_changes',{ event:'*', schema:'public', table:'entries' }, onRemote)
        .on('postgres_changes',{ event:'*', schema:'public', table:'config' }, onRemote)
        .subscribe();
    }catch(e){ console.error('realtime subscribe failed', e); }
  }
  function onRemote(){
    clearTimeout(pullTimer);
    pullTimer=setTimeout(function(){ pullAll().then(softRefresh); }, 700);
  }
  function softRefresh(){
    var a=document.activeElement;
    var editing = a && (a.tagName==='INPUT'||a.tagName==='SELECT'||a.tagName==='TEXTAREA') && a.closest && a.closest('#pane-entry');
    if(editing) return; // don't yank the form out from under someone mid-entry
    if(typeof refreshActive==='function') refreshActive();
  }

  // ---------- status bar (reuses #dataBar) ----------
  function bar(state){
    var el=document.getElementById('dataBar'); if(!el) return;
    var dot = state==='error' ? '#F93820' : (state==='saving' ? '#F7B61F' : '#39B54A');
    var txt = state==='error' ? 'Sync error — will retry on next change' : (state==='saving' ? 'Saving to cloud…' : 'Synced to cloud');
    var imp = (ROLE==='owner') ? ' <button class="btn ghost sm" id="cImport">Import existing data</button>' : '';
    var roleLabel = (ROLE||'');
    var roleNote = '';
    if(ROLE==='accountant'){ roleNote = ' <span style="background:#3488C0;color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:.04em">READ-ONLY</span>'; }
    el.innerHTML =
      '<span style="font-weight:600;font-size:12.5px"><span style="color:'+dot+'">●</span> '+txt+'</span>'+
      ' <span style="opacity:.6;font-size:12px">· signed in as '+(ME||'')+' ('+roleLabel+')</span>'+
      roleNote +
      imp+
      ' <button class="btn ghost sm" id="cOut">Sign out</button>';
    var ib=document.getElementById('cImport'); if(ib) ib.onclick=importLocal;
    var ob=document.getElementById('cOut'); if(ob) ob.onclick=function(){ sb.auth.signOut().then(function(){ location.reload(); }); };
  }

  // ---------- one-time migration: import a JSON data file and push it up ----------
  function importLocal(){
    if(ROLE!=='owner'){ alert('Only the owner can import the master data.'); return; }
    if(!confirm('Import a DCR data file and upload it to the cloud? This replaces the current cloud data with the file you pick.')) return;
    var inp=document.createElement('input'); inp.type='file'; inp.accept='application/json,.json';
    inp.onchange=function(){
      var f=inp.files && inp.files[0]; if(!f) return;
      var rd=new FileReader();
      rd.onload=function(){
        try{
          var parsed=JSON.parse(rd.result);
          var draft=S.draft;
          S=normalize(parsed); S.draft=draft;
          synced={ cfg:null, ent:{} };   // force a full re-push
          save();                        // -> cloudOnSave -> pushDeltas (everything is "new")
          if(typeof refreshActive==='function') refreshActive();
          alert('Imported. Uploading to the cloud now — give it a few seconds, then check another device.');
        }catch(err){ alert('Could not read that file: '+err.message); }
      };
      rd.readAsText(f);
    };
    inp.click();
  }

  // ---------- boot ----------
  function boot(){
    if(booting||READY) return;
    booting=true;
    loginScreen('Checking sign-in…');
    checkAuthorized().then(function(authed){
      if(!ME){ booting=false; loginScreen(); return; }
      if(!authed){ booting=false; loginScreen(ME+" isn't on the access list yet — ask the owner to add your email."); return; }
      return pullAll().then(function(){
        READY=true; booting=false;
        subscribe();
        hideOverlay();
        bar('saved');
        // Accountants land on History (the only tab visible to them)
        if(ROLE==='accountant'){
          try{ document.querySelector('#tabnav button[data-tab="history"]').click(); }catch(_){}
          try{ document.querySelectorAll('.sidebar .side-item').forEach(function(b){ b.classList.toggle('active', b.dataset.side==='history'); }); }catch(_){}
        } else if(typeof refreshActive==='function') refreshActive();
      });
    }).catch(function(e){
      booting=false; console.error(e);
      loginScreen('Could not reach the database. Check your connection and try again.');
    });
  }

  sb.auth.onAuthStateChange(function(evt){
    if(evt==='SIGNED_IN') boot();
    if(evt==='SIGNED_OUT'){ READY=false; loginScreen(); }
  });

  if(document.readyState!=='loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
