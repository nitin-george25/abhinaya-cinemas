/*
 * 05-fb-combined.js
 * Phase A refactor: extracted verbatim from index.html.
 * F&B combined CSV bulk upload (block #4)
 *
 * Phase B notes:
 *   - Convert to ES module: replace globals with explicit import/export.
 *   - Pure functions (no DOM) → keep / move to js/engine/.
 *   - Render functions (touch DOM) → keep in this layer; become components later.
 */

(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    var pending = null;

    function parseCSVrows(text){
      var rows=[], i=0, cell='', row=[], inQ=false;
      while(i<text.length){
        var c=text[i];
        if(inQ){
          if(c==='"' && text[i+1]==='"'){ cell+='"'; i+=2; continue; }
          if(c==='"'){ inQ=false; i++; continue; }
          cell+=c; i++; continue;
        }
        if(c==='"'){ inQ=true; i++; continue; }
        if(c===','){ row.push(cell); cell=''; i++; continue; }
        if(c==='\r'){ i++; continue; }
        if(c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; i++; continue; }
        cell+=c; i++;
      }
      if(cell.length || row.length){ row.push(cell); rows.push(row); }
      return rows;
    }
    function normDate(d){
      d=(d||'').trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      var m=d.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
      if(m){ var y=parseInt(m[3],10); if(y<100) y+=2000; return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'); }
      return '';
    }
    function num(v){ if(v===undefined||v===null) return 0; v=String(v).trim().replace(/,/g,''); if(v==='') return 0; var n=Number(v); return isFinite(n)?n:0; }

    var KEYS = {
      'date':'date','bills':'bills','take away':'takeAway','takeaway':'takeAway',
      'super category':'superCategory','supercategory':'superCategory','category':'category',
      'item name':'name','item':'name','itemname':'name',
      'quantity':'qty','qty':'qty','rate':'rate','unit price':'rate','unit rate':'rate',
      'discount':'discount','complimentary':'complimentary','comp':'complimentary',
      'promotional':'promotional','promo':'promotional',
      'net amount':'netAmount','net':'netAmount','netamount':'netAmount',
      'tax':'tax','total amount':'totalAmount','total':'totalAmount','totalamount':'totalAmount',
      'notes':'notes'
    };

    function parseCombined(text){
      // strip # comment lines
      text = text.split(/\r?\n/).filter(function(l){return !/^\s*#/.test(l);}).join('\n');
      var rows = parseCSVrows(text);
      var hi = -1;
      for(var i=0;i<rows.length;i++){
        var lc = rows[i].map(function(x){return (x||'').trim().toLowerCase();});
        if(lc.indexOf('date')>=0 && lc.some(function(h){return KEYS[h]==='name';})){ hi=i; break; }
      }
      if(hi<0) throw new Error('Header row not found (need Date + ItemName columns).');
      var H = rows[hi].map(function(h){return (h||'').trim().toLowerCase();});
      var F = H.map(function(h){return KEYS[h]||null;});
      function idx(k){ return F.indexOf(k); }
      var byDate = {};
      var errors = [];
      for(var r=hi+1;r<rows.length;r++){
        var row = rows[r];
        if(!row || !row.some(function(v){return (v||'').trim();})) continue;
        function v(k){ var x=idx(k); return x<0?'':row[x]; }
        var d = normDate(v('date'));
        if(!d){ if((v('date')||'').trim()) errors.push('Row '+(r+1)+': bad date'); continue; }
        var name = (v('name')||'').trim();
        if(!name){ errors.push('Row '+(r+1)+': missing item name'); continue; }
        var qty = num(v('qty'));
        if(qty<=0){ errors.push('Row '+(r+1)+': qty must be > 0'); continue; }
        var rate = num(v('rate'));
        var disc = num(v('discount')), comp = num(v('complimentary')), promo = num(v('promotional'));
        var net = (idx('netAmount')>=0 && (v('netAmount')||'').toString().trim()!=='') ? num(v('netAmount')) : null;
        var tax = (idx('tax')>=0 && (v('tax')||'').toString().trim()!=='') ? num(v('tax')) : null;
        var total = (idx('totalAmount')>=0 && (v('totalAmount')||'').toString().trim()!=='') ? num(v('totalAmount')) : null;
        // Derivations
        if(net===null && total===null){
          // Try to use catalog GST if we know the item, else 5%
          var cat = (S.fbProducts||[]).find(function(p){return (p.name||'').toLowerCase() === name.toLowerCase();});
          var gst = cat && cat.gstPct!=null ? Number(cat.gstPct) : 5;
          net = Math.round((qty*rate - disc - comp - promo)*100)/100;
          tax = tax===null ? Math.round(net*(gst/100)*100)/100 : tax;
          total = Math.round((net+tax)*100)/100;
        } else if(net===null && total!==null){
          tax = tax===null ? 0 : tax;
          net = Math.round((total-tax)*100)/100;
        } else if(net!==null && total===null){
          tax = tax===null ? 0 : tax;
          total = Math.round((net+tax)*100)/100;
        } else if(net!==null && total!==null && tax===null){
          tax = Math.round((total-net)*100)/100;
        }
        if((rate===0||isNaN(rate)) && qty>0) rate = Math.round(((net||0)+disc+comp+promo)/qty*100)/100;
        if(!byDate[d]) byDate[d]={ date:d, bills:null, takeAway:null, items:[], notes:'' };
        var day = byDate[d];
        if(v('bills')!=='' && day.bills===null) day.bills = num(v('bills'));
        if(v('takeAway')!=='' && day.takeAway===null) day.takeAway = num(v('takeAway'));
        if(v('notes')!=='' && !day.notes) day.notes = String(v('notes')).trim();
        day.items.push({
          sl: day.items.length+1,
          superCategory: (v('superCategory')||'Indian').toString().trim(),
          category: (v('category')||'').toString().trim(),
          name: name, qty: qty, rate: rate,
          discount: disc, complimentary: comp, promotional: promo,
          netAmount: net||0, tax: tax||0, totalAmount: total||0
        });
      }
      // Build day summaries
      var out = Object.keys(byDate).sort().map(function(k){
        var day = byDate[k];
        var sumNet=0, sumTax=0, sumTot=0, sumBev=0;
        day.items.forEach(function(it){
          sumNet+=it.netAmount||0; sumTax+=it.tax||0; sumTot+=it.totalAmount||0;
          var c = (it.category||'').toLowerCase();
          if(c==='drinks'||c==='beverages') sumBev+=it.netAmount||0;
        });
        function r2(n){return Math.round(n*100)/100;}
        var summary = {
          grossSales: r2(sumNet),
          foodSales: r2(sumNet-sumBev),
          beveragesSales: r2(sumBev),
          netSalesWithoutTax: r2(sumNet),
          addTax: r2(sumTax),
          netSalesWithTax: r2(sumTot)
        };
        if(day.bills    !== null) summary.bills    = day.bills;
        if(day.takeAway !== null) summary.takeAway = day.takeAway;
        return { date: day.date, items: day.items, summary: summary, notes: day.notes };
      });
      return { days: out, errors: errors };
    }

    document.addEventListener('click', function(e){
      if(e.target.id==='fbCombTemplate'){
        var csv = '# Combined F&B CSV — multi-day backfill or bulk corrections\n' +
                  '# Required: Date, ItemName, Qty. NetAmount/Tax/TotalAmount auto-fill if blank.\n' +
                  '# Date format: YYYY-MM-DD or DD-MM-YYYY. Tax defaults to 5% (or matches the catalog).\n' +
                  '# Bills/TakeAway only need to be set once per day.\n' +
                  'Date,Bills,TakeAway,SuperCategory,Category,ItemName,Qty,Rate,Discount,Complimentary,Promotional,NetAmount,Tax,TotalAmount,Notes\n' +
                  '2026-04-01,520,520,Indian,Snacks,Popcorn Salted Small (40g),140,114.29,,,,,,,Sample day\n' +
                  '2026-04-01,,,Indian,Drinks,Coke (340ml),60,104.76,,,,,,,\n';
        var blob = new Blob([csv], {type:'text/csv'});
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fb_combined_template.csv'; a.click();
      }
      if(e.target.id==='fbCombUpload'){ document.getElementById('fbCombFile').click(); }
      if(e.target.id==='fbCombImport'){
        if(!pending || !pending.length) return;
        if(!confirm('Import '+pending.length+' day(s)? Existing F&B entries for these dates will be REPLACED.')) return;
        var sb = window._sb; if(!sb){ alert('Cloud not connected.'); return; }
        var me=''; try{ var b=document.getElementById('dataBar'); var m=(b&&b.textContent||'').match(/signed in as ([^\s]+)/); if(m) me=m[1]; }catch(_){}
        var ops = pending.map(function(d){
          return sb.from('fb_entries').upsert({
            entry_date: d.date, items: d.items, summary: d.summary, notes: d.notes||'',
            updated_by: me, updated_at: new Date().toISOString()
          }, { onConflict: 'entry_date' });
        });
        Promise.all(ops).then(function(results){
          var errs = results.filter(function(r){return r.error;});
          if(errs.length){ alert(errs.length+' day(s) failed to save. Check console.'); console.error(errs); }
          else {
            document.getElementById('fbCombPreview').innerHTML = '<span style="color:#2a8">✓ Imported '+pending.length+' day(s).</span>';
            pending = null;
            document.getElementById('fbCombImport').style.display='none';
            // Update local model so UI refreshes
            results.forEach(function(_, i){
              var d = pending && pending[i] ? pending[i] : null; // pending was set to null above; use the import set instead
            });
            if(window.__pullProducts) window.__pullProducts();
            // Trigger F&B refresh
            setTimeout(function(){ if(typeof window.renderFB==='function') window.renderFB(); }, 200);
          }
        });
      }
    });

    document.addEventListener('change', function(e){
      if(e.target.id!=='fbCombFile') return;
      var f = e.target.files && e.target.files[0]; if(!f) return;
      var rd = new FileReader();
      rd.onload = function(){
        try{
          var parsed = parseCombined(rd.result);
          pending = parsed.days;
          var inr = function(n){var x=Number(n)||0; return x.toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2});};
          var html = '<b>'+pending.length+' day(s) ready, '+pending.reduce(function(t,d){return t+d.items.length;},0)+' item rows total.</b><br><br>';
          html += '<div style="max-height:280px;overflow:auto"><table class="grid"><tr><th>Date</th><th>Items</th><th>Bills</th><th>Net</th><th>Tax</th><th>Total</th></tr>';
          pending.forEach(function(d){
            var sm = d.summary||{};
            var existing = (S.fbEntries||[]).find(function(x){return x.date===d.date;});
            html += '<tr><td>'+d.date+(existing?' <span style="color:#c80;font-size:11px">(replaces)</span>':'')+'</td>'+
              '<td style="text-align:right">'+d.items.length+'</td>'+
              '<td style="text-align:right">'+(sm.bills==null?'—':sm.bills)+'</td>'+
              '<td style="text-align:right">₹'+inr(sm.grossSales)+'</td>'+
              '<td style="text-align:right">₹'+inr(sm.addTax)+'</td>'+
              '<td style="text-align:right">₹'+inr(sm.netSalesWithTax)+'</td></tr>';
          });
          html += '</table></div>';
          if(parsed.errors.length){
            html += '<br><span style="color:#c00"><b>'+parsed.errors.length+' row(s) skipped</b></span>';
            if(parsed.errors.length <= 5){
              html += ':<ul style="margin:4px 0 0 18px">';
              parsed.errors.forEach(function(s){ html += '<li>'+String(s).replace(/[&<>]/g,function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;"})[c];})+'</li>'; });
              html += '</ul>';
            } else { html += ' (open the console for details)'; console.warn('Skipped rows:', parsed.errors); }
          }
          document.getElementById('fbCombPreview').innerHTML = html;
          document.getElementById('fbCombImport').style.display = pending.length ? '' : 'none';
        }catch(err){
          document.getElementById('fbCombPreview').innerHTML = '<span style="color:#c00"><b>Could not read CSV:</b> '+String(err.message).replace(/[&<>]/g,function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;"})[c];})+'</span>';
          document.getElementById('fbCombImport').style.display='none';
        }
        e.target.value='';
      };
      rd.readAsText(f);
    });
  });
})();
