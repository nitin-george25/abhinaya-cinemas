/*
 * 06-fb-menu.js
 * Phase A refactor: extracted verbatim from index.html.
 * Editable Menu Items table (block #5)
 *
 * Phase B notes:
 *   - Convert to ES module: replace globals with explicit import/export.
 *   - Pure functions (no DOM) → keep / move to js/engine/.
 *   - Render functions (touch DOM) → keep in this layer; become components later.
 */

(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    function isOwnerNow(){ try{ var b=document.getElementById('dataBar'); return b && /\(owner\)/.test(b.textContent||''); }catch(e){ return false; } }
    function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c];}); }
    function fmt(n){ var x=Number(n); if(!isFinite(x)) x=0; return x.toLocaleString('en-IN',{maximumFractionDigits:2, minimumFractionDigits:2}); }
    function gstPillClass(g){ var n=Number(g)||0; if(n>=18) return 'gst-18'; if(n>=12) return 'gst-12'; return 'gst-5'; }

    function renderProductsEditable(){
      var t = document.getElementById('fbProductsTable'); if(!t) return;
      var owner = isOwnerNow();
      var addBtn = document.getElementById('fbAddProduct');
      var upBtn  = document.getElementById('fbCatUpload');
      if(addBtn) addBtn.style.display = owner ? '' : 'none';
      if(upBtn)  upBtn.style.display  = owner ? '' : 'none';

      var html = '<tr><th style="min-width:60px">Item #</th><th>Name</th><th>Category</th><th style="width:120px">Default rate (₹)</th><th style="width:110px">GST %</th><th style="width:90px"></th></tr>';
      if(!S.fbProducts || !S.fbProducts.length){
        html += '<tr><td colspan="6" style="opacity:.6">No products yet. '+(owner?'Add one above or upload items.csv.':'Ask the owner to add some.')+'</td></tr>';
      } else {
        var list = (S.fbProducts||[]).slice().sort(function(a,b){
          var c = String(a.category||'').localeCompare(b.category||'');
          if(c) return c;
          return String(a.name||'').localeCompare(b.name||'');
        });
        list.forEach(function(p){
          if(owner){
            html += '<tr data-fbpid="'+esc(p.id)+'">'+
              '<td style="opacity:.55;font-size:11px;vertical-align:middle">'+esc(p.itemNumber||p.uid||'')+'</td>'+
              '<td><input type="text" data-fbpf="name" value="'+esc(p.name)+'" placeholder="Item name"></td>'+
              '<td><input type="text" data-fbpf="category" value="'+esc(p.category||'')+'" placeholder="Snacks / Drinks / …" style="width:140px"></td>'+
              '<td><input type="number" min="0" step="0.01" data-fbpf="defaultPrice" value="'+esc(p.defaultPrice==null?'':p.defaultPrice)+'" style="text-align:right"></td>'+
              '<td><input type="number" min="0" max="100" step="0.01" data-fbpf="gstPct" value="'+esc(p.gstPct==null?'':p.gstPct)+'" style="text-align:right"></td>'+
              '<td style="text-align:center"><button class="btn ghost sm" data-fbpd="'+esc(p.id)+'" title="Delete">×</button></td>'+
            '</tr>';
          } else {
            html += '<tr>'+
              '<td style="opacity:.55;font-size:11px">'+esc(p.itemNumber||p.uid||'')+'</td>'+
              '<td>'+esc(p.name)+'</td>'+
              '<td>'+esc(p.category||'')+'</td>'+
              '<td style="text-align:right">₹ '+fmt(p.defaultPrice||0)+'</td>'+
              '<td style="text-align:right"><span class="gst-pill '+gstPillClass(p.gstPct)+'">'+fmt(p.gstPct||0)+'%</span></td>'+
              '<td></td>'+
            '</tr>';
          }
        });
      }
      t.innerHTML = html;
    }
    window.renderProducts = renderProductsEditable;

    var saveTimers = {};
    function flashRow(tr, ok){
      if(!tr) return;
      tr.style.transition = 'background-color .2s';
      tr.style.background = ok ? 'rgba(57,181,74,.10)' : 'rgba(249,56,32,.10)';
      setTimeout(function(){ tr.style.background = ''; }, 700);
    }
    document.addEventListener('input', function(e){
      var f = e.target.dataset && e.target.dataset.fbpf; if(!f) return;
      var tr = e.target.closest('tr[data-fbpid]'); if(!tr) return;
      var id = tr.dataset.fbpid;
      var prod = (S.fbProducts||[]).find(function(p){return p.id===id;}); if(!prod) return;
      if(f==='name' || f==='category') prod[f] = e.target.value;
      else prod[f] = e.target.value==='' ? '' : Number(e.target.value);
      clearTimeout(saveTimers[id]);
      saveTimers[id] = setTimeout(function(){
        var sb = window._sb; if(!sb) return;
        var row = {
          name: (prod.name||'').trim(),
          category: prod.category||'',
          super_category: prod.superCategory||'',
          default_rate: prod.defaultPrice===''||prod.defaultPrice==null ? 0 : Number(prod.defaultPrice),
          default_gst_pct: prod.gstPct===''||prod.gstPct==null ? 5 : Number(prod.gstPct),
          pos_item_number: prod.itemNumber||null,
          is_non_veg: !!prod.nonVeg,
          is_active: prod.isActive!==false,
          updated_at: new Date().toISOString()
        };
        sb.from('fb_products').update(row).eq('id', id).then(function(r){
          flashRow(tr, !r.error);
          if(r.error){ console.error('product update', r.error); }
        });
      }, 600);
    });

    document.addEventListener('click', function(e){
      if(e.target.dataset && e.target.dataset.fbpd){
        if(!isOwnerNow()){ alert('Only the owner can delete products.'); return; }
        var id = e.target.dataset.fbpd;
        var p = (S.fbProducts||[]).find(function(x){return x.id===id;});
        var nm = p ? p.name : '(unnamed)';
        if(!confirm('Delete product "'+nm+'"? Historical sales records stay intact.')) return;
        var sb = window._sb;
        sb.from('fb_products').delete().eq('id', id).then(function(r){
          if(r.error){ alert('Delete failed: '+r.error.message); return; }
          S.fbProducts = (S.fbProducts||[]).filter(function(x){return x.id!==id;});
          renderProductsEditable();
        });
      }
      if(e.target.id==='fbAddProduct'){
        if(!isOwnerNow()){ alert('Only the owner can add products.'); return; }
        var sb = window._sb;
        var row = {
          name: 'New product '+(Math.floor(Math.random()*9000)+1000),
          category: '',
          super_category: 'Indian',
          default_rate: 0,
          default_gst_pct: 5,
          is_active: true
        };
        sb.from('fb_products').insert(row).select().then(function(r){
          if(r.error){ alert('Add failed: '+r.error.message); return; }
          if(typeof pullProducts==='function') pullProducts();
          else if(window.__pullProducts) window.__pullProducts();
          else renderProductsEditable();
        });
      }
    });
  });
})();
