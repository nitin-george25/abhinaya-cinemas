/*
 * 04-fb-subtabs.js
 * Phase A refactor: extracted verbatim from index.html.
 * Sidebar/dashboard hooks + bulk DSR multi-file handler (block #3)
 *
 * Phase B notes:
 *   - Convert to ES module: replace globals with explicit import/export.
 *   - Pure functions (no DOM) → keep / move to js/engine/.
 *   - Render functions (touch DOM) → keep in this layer; become components later.
 */

(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    // -------- Sidebar drives the existing #tabnav buttons --------
    var TAB_OF = {}; // side -> tab
    document.querySelectorAll('.sidebar .side-item[data-side]').forEach(function(b){ TAB_OF[b.dataset.side] = b.dataset.side; });

    function activate(tab){
      // mark sidebar
      document.querySelectorAll('.sidebar .side-item').forEach(function(b){ b.classList.toggle('active', b.dataset.side===tab); });
      // dispatch to existing tab handler by clicking the hidden tab button
      var btn = document.querySelector('#tabnav button[data-tab="'+tab+'"]');
      if(btn){ btn.click(); }
    }

    document.querySelector('.sidebar').addEventListener('click', function(e){
      var b = e.target.closest && e.target.closest('.side-item');
      if(!b || b.classList.contains('muted')) return;
      var tab = b.dataset.side;
      if(!tab) return;
      activate(tab);
    });

    // Also keep sidebar in sync if something else changes the active tab
    var tabnav = document.getElementById('tabnav');
    if(tabnav){
      tabnav.addEventListener('click', function(e){
        if(e.target.tagName==='BUTTON'){
          var t = e.target.dataset.tab;
          document.querySelectorAll('.sidebar .side-item').forEach(function(b){ b.classList.toggle('active', b.dataset.side===t); });
        }
      });
    }

    // Owner's Dashboard rendering is implemented in the separate richer module
    // appended at the end of the document. Keep this stub so older callers
    // still resolve to a function.
    function renderDashboard(){ if(window.__renderDashboard) window.__renderDashboard(); }
    window.renderDashboard = renderDashboard;

    // Make the tab handler call renderDashboard when 'dashboard' is shown
    if(tabnav){
      tabnav.addEventListener('click', function(e){
        if(e.target.tagName==='BUTTON' && e.target.dataset.tab==='dashboard'){
          setTimeout(renderDashboard, 0);
        }
      });
    }

    // -------- Bulk DSR upload --------
    var bulkPending = null;

    document.addEventListener('click', function(e){
      if(e.target.id==='fbBulkUpload'){
        document.getElementById('fbBulkFile').click();
      }
      if(e.target.id==='fbBulkImport'){
        if(!bulkPending || !bulkPending.length){ return; }
        if(!confirm('Import '+bulkPending.length+' F&B day(s)? Existing entries on those dates will be REPLACED.')) return;
        bulkPending.forEach(function(parsed){
          var existing = (S.fbEntries||[]).find(function(x){return x.date===parsed.date;});
          if(existing){
            existing.items = parsed.items;
            existing.summary = parsed.summary;
          } else {
            S.fbEntries.push({ id: Math.random().toString(36).slice(2,9), date: parsed.date, items: parsed.items, summary: parsed.summary, notes:'' });
          }
        });
        bulkPending=null;
        document.getElementById('fbBulkPreview').innerHTML = '<span style="color:#2a8">Imported. Syncing to the cloud…</span>';
        document.getElementById('fbBulkImport').style.display='none';
        if(typeof save==='function') save();
        if(typeof window.renderFB==='function') window.renderFB();
      }
    });

    document.addEventListener('change', function(e){
      if(e.target.id!=='fbBulkFile') return;
      var files = e.target.files; if(!files || !files.length) return;
      var parsed=[], errors=[];
      var pending = files.length;
      Array.prototype.forEach.call(files, function(f){
        var rd = new FileReader();
        rd.onload = function(){
          try{
            // call the parseDSR function from the F&B module
            var p = window.__parseDSR ? window.__parseDSR(rd.result) : null;
            if(!p){ throw new Error('F&B module not ready'); }
            parsed.push({date:p.date, items:p.items, summary:p.summary, file:f.name});
          }catch(err){
            errors.push(f.name+': '+err.message);
          }
          pending--;
          if(pending<=0){ finish(); }
        };
        rd.onerror = function(){ errors.push(f.name+': read error'); pending--; if(pending<=0) finish(); };
        rd.readAsText(f);
      });
      e.target.value='';

      function finish(){
        // dedupe by date — keep the last parse for any duplicate date and warn
        var byDate = {};
        parsed.forEach(function(p){ byDate[p.date] = p; });
        bulkPending = Object.keys(byDate).sort().map(function(k){ return byDate[k]; });

        var html = '<b>'+bulkPending.length+' day(s) ready to import.</b>';
        if(parsed.length>bulkPending.length){
          html += ' <span style="color:#c80">('+(parsed.length-bulkPending.length)+' duplicate-date file(s) collapsed — only the last one for each date will be saved.)</span>';
        }
        html += '<br><br><table class="grid" style="max-width:640px"><tr><th>Date</th><th>Items</th><th>Gross</th><th>Net w/ Tax</th></tr>';
        bulkPending.forEach(function(p){
          var sm = p.summary||{};
          var inr = function(n){ var x=Number(n)||0; return x.toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2}); };
          var existing = (S.fbEntries||[]).find(function(x){return x.date===p.date;});
          html += '<tr><td>'+p.date+(existing?' <span style="color:#c80">(replaces existing)</span>':'')+'</td><td style="text-align:right">'+p.items.length+'</td><td style="text-align:right">₹ '+inr(sm.grossSales)+'</td><td style="text-align:right">₹ '+inr(sm.netSalesWithTax)+'</td></tr>';
        });
        html += '</table>';
        if(errors.length){
          html += '<br><span style="color:#c00"><b>'+errors.length+' file(s) skipped:</b></span><ul style="margin:4px 0 0 18px">';
          errors.slice(0,8).forEach(function(s){ html += '<li>'+s.replace(/[&<>]/g,function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;"})[c];})+'</li>'; });
          if(errors.length>8) html += '<li>… +'+(errors.length-8)+' more</li>';
          html += '</ul>';
        }
        document.getElementById('fbBulkPreview').innerHTML = html;
        document.getElementById('fbBulkImport').style.display = bulkPending.length ? '' : 'none';
      }
    });


  });
})();
