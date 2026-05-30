/*
 * 09-backup-changes.js
 * Phase A refactor: extracted verbatim from index.html.
 * Last-exported indicator + Recent changes feed (block #8)
 *
 * Phase B notes:
 *   - Convert to ES module: replace globals with explicit import/export.
 *   - Pure functions (no DOM) → keep / move to js/engine/.
 *   - Render functions (touch DOM) → keep in this layer; become components later.
 */

(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){

    function renderLastExport(){
      var el = document.getElementById('lastExportIndicator'); if(!el) return;
      var iso = null;
      try{ iso = localStorage.getItem('abhinaya_dcr_last_export'); }catch(e){}
      if(!iso){
        el.innerHTML = '<span style="color:#c33">●</span> <b>You have never exported a backup.</b> Click "Export a snapshot" below to save your first one.';
        return;
      }
      var then = new Date(iso); var now = new Date();
      var diffH = (now - then) / (1000 * 60 * 60);
      var diffD = Math.floor(diffH / 24);
      var label, color;
      if(diffH < 24){ label = 'Last exported today ('+then.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})+')'; color = '#2a8'; }
      else if(diffD === 1){ label = 'Last exported yesterday'; color = '#2a8'; }
      else if(diffD < 8){ label = 'Last exported '+diffD+' days ago'; color = '#c80'; }
      else { label = 'Last exported '+diffD+' days ago — please back up soon'; color = '#c33'; }
      el.innerHTML = '<span style="color:'+color+'">●</span> '+label;
    }
    window.__renderLastExport = renderLastExport;

    var tabnav = document.getElementById('tabnav');
    if(tabnav){
      tabnav.addEventListener('click', function(e){
        if(e.target.tagName==='BUTTON' && e.target.dataset.tab==='backup'){
          setTimeout(renderLastExport, 10);
        }
      });
    }
    renderLastExport();

    var ESC = function(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c];}); };
    function relTime(iso){
      if(!iso) return '';
      var then = new Date(iso); var now = new Date();
      var diff = (now - then) / 1000;
      if(diff < 60) return 'just now';
      if(diff < 3600) return Math.floor(diff/60) + 'm ago';
      if(diff < 86400) return Math.floor(diff/3600) + 'h ago';
      var d = Math.floor(diff / 86400);
      if(d < 30) return d + 'd ago';
      return then.toISOString().slice(0,10);
    }
    function describeEntry(e){
      var m = (S.movies||[]).find(function(x){return x.id===e.movie_id;});
      var sc = (S.screens||[]).find(function(x){return x.id===e.screen_id;});
      return 'BO DCR — ' + (m?m.name:'?') + ' on ' + (sc?sc.name:'?') + ' (' + (e.entry_date||'') + ')';
    }
    function describeFb(e){ return 'F&B day — ' + (e.entry_date || ''); }
    function describeProduct(p){ return 'Catalog product — ' + (p.name || '?'); }
    function describeConfig(){ return 'Cinema config (rates / screens / cards / movies / openings / serials)'; }

    function fetchRecent(){
      var sb = window._sb; if(!sb) return Promise.resolve([]);
      var jobs = [
        sb.from('entries').select('entry_date,movie_id,screen_id,updated_by,updated_at').order('updated_at',{ascending:false}).limit(25)
          .then(function(r){ return (r.data||[]).map(function(e){ return {when:e.updated_at, who:e.updated_by||'?', what:describeEntry(e)}; }); }),
        sb.from('fb_entries').select('entry_date,updated_by,updated_at').order('updated_at',{ascending:false}).limit(25)
          .then(function(r){ return (r.data||[]).map(function(e){ return {when:e.updated_at, who:e.updated_by||'?', what:describeFb(e)}; }); }),
        sb.from('config').select('updated_by,updated_at').limit(1)
          .then(function(r){ return (r.data||[]).map(function(e){ return {when:e.updated_at, who:e.updated_by||'?', what:describeConfig()}; }); }),
        sb.from('fb_products').select('name,updated_at').order('updated_at',{ascending:false}).limit(15)
          .then(function(r){ return (r.data||[]).map(function(e){ return {when:e.updated_at, who:'(catalog edit)', what:describeProduct(e)}; }); })
      ];
      return Promise.all(jobs).then(function(parts){
        var all = [].concat.apply([], parts).filter(function(x){ return x.when; });
        all.sort(function(a,b){ return (b.when||'').localeCompare(a.when||''); });
        return all.slice(0, 20);
      }).catch(function(e){ console.error('recent changes fetch', e); return []; });
    }

    function renderRecentChanges(){
      var host = document.getElementById('dashRecent'); if(!host) return;
      host.innerHTML = '<span style="opacity:.6">Loading…</span>';
      fetchRecent().then(function(items){
        if(!items.length){ host.innerHTML = '<span style="opacity:.6">No activity yet.</span>'; return; }
        var html = '<table class="grid" style="width:100%"><thead><tr><th style="width:90px">When</th><th>What</th><th>Who</th></tr></thead><tbody>';
        items.forEach(function(it){
          html += '<tr><td style="opacity:.7">'+ESC(relTime(it.when))+'</td><td>'+ESC(it.what)+'</td><td style="opacity:.7">'+ESC(it.who)+'</td></tr>';
        });
        html += '</tbody></table>';
        host.innerHTML = html;
      });
    }

    if(tabnav){
      tabnav.addEventListener('click', function(e){
        if(e.target.tagName==='BUTTON' && e.target.dataset.tab==='dashboard'){
          setTimeout(renderRecentChanges, 60);
        }
      });
    }
    window.__renderRecentChanges = renderRecentChanges;
  });
})();


// ====================== Activity Log (filterable, tagged) ======================
(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    var ESC = function(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c];}); };

    function relTime(iso){
      if(!iso) return '';
      var then = new Date(iso); var now = new Date();
      var diff = (now - then) / 1000;
      if(diff < 60) return 'just now';
      if(diff < 3600) return Math.floor(diff/60) + 'm ago';
      if(diff < 86400) return Math.floor(diff/3600) + 'h ago';
      var d = Math.floor(diff / 86400);
      if(d < 30) return d + 'd ago';
      return then.toISOString().slice(0,10);
    }
    function absTime(iso){ if(!iso) return ''; var d = new Date(iso); return d.toLocaleString('en-IN', {dateStyle:'short', timeStyle:'short'}); }

    function cinemaName(){
      try{ return (S && S.cinema && S.cinema.name) || 'Cinema'; }catch(e){ return 'Cinema'; }
    }
    function movieName(id){
      var m = (S.movies||[]).find(function(x){return x.id===id;});
      return m ? m.name : '?';
    }
    function screenName(id){
      var sc = (S.screens||[]).find(function(x){return x.id===id;});
      return sc ? sc.name : '?';
    }

    var BO  = 'bo', FB = 'fb', CFG = 'cfg', CAT = 'cat';
    var typeLabels = { bo:'BO DCR', fb:'F&B day', cfg:'Cinema config', cat:'Catalog' };
    var typeColors = { bo:'#3488C0', fb:'#F7B61F', cfg:'#9aa0a6', cat:'#39B54A' };

    function describeEntry(e){
      var movie = movieName(e.movie_id);
      var screen = screenName(e.screen_id);
      var loc = cinemaName();
      return {
        type: BO,
        location: loc,
        screen: screen,
        movie: movie,
        date: e.entry_date || '',
        text: movie + ' on ' + screen + ' (' + (e.entry_date||'') + ')'
      };
    }
    function describeFb(e){
      return {
        type: FB,
        location: cinemaName(),
        screen: '—',
        movie: '—',
        date: e.entry_date || '',
        text: 'F&B sales for ' + (e.entry_date||'')
      };
    }
    function describeCfg(e){
      return {
        type: CFG,
        location: cinemaName(),
        screen: '—',
        movie: '—',
        date: '',
        text: 'Cinema configuration updated (rates / screens / cards / movies / openings / serials)'
      };
    }
    function describeCat(p){
      return {
        type: CAT,
        location: cinemaName(),
        screen: '—',
        movie: '—',
        date: '',
        text: 'Catalog product: ' + (p.name || '?')
      };
    }

    // Cache of recently-fetched events so filters apply client-side
    var cache = [];

    function fetchAll(){
      var sb = window._sb; if(!sb) return Promise.resolve([]);
      var jobs = [
        sb.from('entries').select('entry_date,movie_id,screen_id,updated_by,updated_at').order('updated_at',{ascending:false}).limit(200)
          .then(function(r){ return (r.data||[]).map(function(e){
            var d = describeEntry(e); d.when = e.updated_at; d.who = e.updated_by || '?'; return d;
          }); }),
        sb.from('fb_entries').select('entry_date,updated_by,updated_at').order('updated_at',{ascending:false}).limit(200)
          .then(function(r){ return (r.data||[]).map(function(e){
            var d = describeFb(e); d.when = e.updated_at; d.who = e.updated_by || '?'; return d;
          }); }),
        sb.from('config').select('updated_by,updated_at').limit(1)
          .then(function(r){ return (r.data||[]).map(function(e){
            var d = describeCfg(e); d.when = e.updated_at; d.who = e.updated_by || '?'; return d;
          }); }),
        sb.from('fb_products').select('name,updated_at').order('updated_at',{ascending:false}).limit(50)
          .then(function(r){ return (r.data||[]).map(function(e){
            var d = describeCat(e); d.when = e.updated_at; d.who = '(catalog edit)'; return d;
          }); })
      ];
      return Promise.all(jobs).then(function(parts){
        var all = [].concat.apply([], parts).filter(function(x){ return x.when; });
        all.sort(function(a,b){ return (b.when||'').localeCompare(a.when||''); });
        return all;
      }).catch(function(e){ console.error('activity fetch', e); return []; });
    }

    function getFilters(){
      return {
        user: (document.getElementById('al_user')||{}).value || '',
        type: (document.getElementById('al_type')||{}).value || '',
        from: (document.getElementById('al_from')||{}).value || '',
        to:   (document.getElementById('al_to')||{}).value || ''
      };
    }

    function applyFilters(items, f){
      return items.filter(function(it){
        if(f.user && it.who !== f.user) return false;
        if(f.type && it.type !== f.type) return false;
        if(f.from || f.to){
          var d = (it.when||'').slice(0,10);
          if(f.from && d < f.from) return false;
          if(f.to && d > f.to) return false;
        }
        return true;
      });
    }

    function refreshUserDropdown(items){
      var sel = document.getElementById('al_user'); if(!sel) return;
      var current = sel.value;
      var users = {}; items.forEach(function(it){ if(it.who) users[it.who] = true; });
      var keys = Object.keys(users).sort();
      sel.innerHTML = '<option value="">All users</option>' + keys.map(function(u){ return '<option value="'+ESC(u)+'">'+ESC(u)+'</option>'; }).join('');
      sel.value = current;
    }

    function paintTable(items){
      var t = document.getElementById('activityTable'); if(!t) return;
      var html = '<thead><tr><th style="width:120px">When</th><th style="width:110px">Type</th><th>Where</th><th>What</th><th>Who</th></tr></thead><tbody>';
      if(!items.length){
        html += '<tr><td colspan="5" style="opacity:.6;padding:14px">No matching activity. Adjust filters or refresh.</td></tr>';
      } else {
        items.slice(0, 200).forEach(function(it){
          var label = typeLabels[it.type] || it.type;
          var color = typeColors[it.type] || '#9aa0a6';
          var where = ESC(it.location) + ' · ' + ESC(it.screen || '—');
          html += '<tr>'+
            '<td><span title="'+ESC(absTime(it.when))+'">'+ESC(relTime(it.when))+'</span></td>'+
            '<td><span style="background:'+color+'22;color:'+color+';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.04em">'+ESC(label)+'</span></td>'+
            '<td>'+where+'</td>'+
            '<td>'+ESC(it.text)+'</td>'+
            '<td style="opacity:.75">'+ESC(it.who)+'</td>'+
          '</tr>';
        });
      }
      html += '</tbody>';
      t.innerHTML = html;
      var st = document.getElementById('al_status'); if(st) st.textContent = items.length + ' event(s)';
    }

    function render(){
      var st = document.getElementById('al_status'); if(st) st.textContent = 'Loading…';
      fetchAll().then(function(items){
        cache = items;
        refreshUserDropdown(items);
        paintTable(applyFilters(items, getFilters()));
      });
    }
    window.__renderActivityLog = render;

    // Filter change handlers (idempotent click delegate)
    document.addEventListener('input', function(e){
      if(['al_user','al_type','al_from','al_to'].indexOf(e.target.id) < 0) return;
      paintTable(applyFilters(cache, getFilters()));
    });
    document.addEventListener('change', function(e){
      if(['al_user','al_type','al_from','al_to'].indexOf(e.target.id) < 0) return;
      paintTable(applyFilters(cache, getFilters()));
    });
    document.addEventListener('click', function(e){
      if(e.target.id === 'al_clear'){
        ['al_user','al_type','al_from','al_to'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
        paintTable(applyFilters(cache, getFilters()));
      }
      if(e.target.id === 'al_refresh'){
        render();
      }
    });
  });
})();
