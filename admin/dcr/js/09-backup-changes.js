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
