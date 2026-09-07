#!/usr/bin/env python3
"""Audit the Stacks Remote UI panel for layout faults, on a real device.

WHY THIS EXISTS.  Every layout fault in this panel was found by the user, one
round trip at a time: a rail that outgrew the viewport, cards crushed and
silently clipped, a shape list you could see past but not scroll to, cards
overlapping the row below.  They are all mechanically detectable, and they are
all invisible to a screenshot glanced at once at one window size.

Checks, per bank and per viewport size:
  overlap   two cards occupying the same pixels without sharing a row
  clipped   a card shorter than its own content (overflow:hidden eats it)
  escape    a card wider than the pane, or the page taller than the viewport
  reach     the LAST control is reachable after scrolling the pane
  scroller  a cell's own scroller clipped by its card, or unable to reach
            its end / its last item (the rubber-band failure)

Run:  tools/stacks/check_panel_layout.py <host> [--sizes 1180x690,1180x560]
Exit non-zero on any fault, with the offending card named.
"""
import base64, json, os, socket, struct, subprocess, sys, time, urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BANKS = ["MAIN", "START", "CHORD", "VOICE", "FEEL", "CLIP"]


def cdp(url, w, h, expr, port=9321):
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--remote-debugging-port=%d" % port, "--window-size=%d,%d" % (w, h),
         "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws = None
        for _ in range(50):
            try:
                for t in json.load(urllib.request.urlopen(
                        "http://127.0.0.1:%d/json" % port)):
                    if t.get("type") == "page":
                        ws = t["webSocketDebuggerUrl"]; break
                if ws: break
            except Exception: pass
            time.sleep(0.4)
        if not ws: sys.exit("could not reach headless Chrome")
        host, rest = ws.split("://", 1)[1].split("/", 1)
        hh, pp = host.split(":")
        s = socket.create_connection((hh, int(pp)), timeout=20)
        s.sendall(("GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n"
                   "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
                   "Sec-WebSocket-Version: 13\r\n\r\n"
                   % (rest, host, base64.b64encode(os.urandom(16)).decode())).encode())
        buf = b""
        while b"\r\n\r\n" not in buf: buf += s.recv(4096)
        st = {"b": buf.split(b"\r\n\r\n", 1)[1]}
        msgs = []

        def send(o):
            pl = json.dumps(o).encode(); m = os.urandom(4); n = len(pl)
            hd = b"\x81" + (bytes([0x80 | n]) if n < 126
                            else bytes([0x80 | 126]) + struct.pack(">H", n))
            s.sendall(hd + m + bytes(b ^ m[i % 4] for i, b in enumerate(pl)))

        def pump(sec):
            d = st["b"]; s.settimeout(0.5); end = time.time() + sec
            while time.time() < end:
                try:
                    c = s.recv(1 << 20)
                    if not c: break
                    d += c
                except socket.timeout: pass
                while len(d) >= 2:
                    ln = d[1] & 0x7F; off = 2
                    if ln == 126:
                        if len(d) < 4: break
                        ln = struct.unpack(">H", d[2:4])[0]; off = 4
                    elif ln == 127:
                        if len(d) < 10: break
                        ln = struct.unpack(">Q", d[2:10])[0]; off = 10
                    if len(d) < off + ln: break
                    msgs.append(d[off:off + ln].decode("utf8", "replace"))
                    d = d[off + ln:]
                st["b"] = d

        send({"id": 1, "method": "Page.enable"})
        send({"id": 2, "method": "Emulation.setDeviceMetricsOverride",
              "params": {"width": w, "height": h, "deviceScaleFactor": 1,
                         "mobile": False}})
        send({"id": 3, "method": "Page.navigate", "params": {"url": url}})
        pump(10)
        send({"id": 9, "method": "Runtime.evaluate",
              "params": {"expression": expr, "returnByValue": True,
                         "awaitPromise": True}})
        pump(25)
        for m in msgs:
            o = json.loads(m)
            if o.get("id") == 9:
                if "exceptionDetails" in o.get("result", {}):
                    sys.exit("page error: %s" % json.dumps(o)[:400])
                return json.loads(o["result"]["result"]["value"])
        sys.exit("no result from the page")
    finally:
        proc.terminate()


AUDIT = r"""
(function(){
  var BANKS = %s;
  function tabs(){ return [].slice.call(document.querySelectorAll('.tab')); }
  function audit(name){
    var p = document.querySelector('.pane');
    var kids = [].slice.call(p.children);
    var pr = p.getBoundingClientRect();
    var cards = kids.map(function(c){
      var r = c.getBoundingClientRect();
      return {k:((c.querySelector('.k')||{}).textContent||'?'),
              top:Math.round(r.top), bot:Math.round(r.bottom),
              left:Math.round(r.left), right:Math.round(r.right),
              h:Math.round(r.height), content:c.scrollHeight};
    });
    var faults = [];
    cards.forEach(function(c){
      if (c.content > c.h + 1) faults.push('clipped: '+c.k+' ('+c.h+'px box, '+c.content+'px content)');
      if (c.right > Math.round(pr.right)+1 || c.left < Math.round(pr.left)-1)
        faults.push('escapes pane horizontally: '+c.k);
    });
    for (var i=0;i<cards.length;i++) for (var j=i+1;j<cards.length;j++){
      var a=cards[i], b=cards[j];
      if (a.top === b.top) continue;               /* same row, side by side */
      var vy = Math.min(a.bot,b.bot) - Math.max(a.top,b.top);
      var vx = Math.min(a.right,b.right) - Math.max(a.left,b.left);
      if (vy > 1 && vx > 1) faults.push('overlap: '+a.k+' / '+b.k+' ('+vy+'px)');
    }
    /*
     * A scroller INSIDE a cell is wanted -- it keeps every cell on the bank in
     * view while the long one moves on its own. What must never happen is the
     * card clipping it: then the list is visible past the edge and unreachable,
     * the drag lands on the pane's overscroll, and it springs back. That was
     * once "fixed" by banning nested scrollers, which was aimed at the symptom;
     * the cause was row sizing. So the check is the real invariant.
     */
    [].forEach.call(p.querySelectorAll('[data-scroll]'), function(e){
      var er = e.getBoundingClientRect();
      var card = e.closest('.ctl');
      var name = card ? ((card.querySelector('.k')||{}).textContent||'?') : '?';
      if (card){
        var cr2 = card.getBoundingClientRect();
        if (er.bottom > cr2.bottom + 1)
          faults.push('scroller clipped by its card: '+name);
      }
      var max = e.scrollHeight - e.clientHeight;
      if (max > 2){
        e.scrollTop = 999999;
        if (e.scrollTop < max - 1)
          faults.push('scroller cannot reach its end: '+name+
                      ' (stopped at '+Math.round(e.scrollTop)+' of '+Math.round(max)+')');
        var kids = e.querySelectorAll('button');
        var last = kids[kids.length-1];
        if (last){
          var lr2 = last.getBoundingClientRect(), er2 = e.getBoundingClientRect();
          if (lr2.bottom > er2.bottom + 1)
            faults.push('last item unreachable in scroller: '+name);
        }
        e.scrollTop = 0;
      }
    });
    p.scrollTop = 999999;
    var last = kids[kids.length-1];
    if (last){
      var lr = last.getBoundingClientRect(), pr2 = p.getBoundingClientRect();
      if (lr.bottom > pr2.bottom + 1)
        faults.push('last card unreachable after scrolling: '+
                    ((last.querySelector('.k')||{}).textContent||'?'));
    }
    p.scrollTop = 0;
    if (document.body.scrollHeight > window.innerHeight + 1)
      faults.push('page taller than viewport ('+document.body.scrollHeight+
                  ' > '+window.innerHeight+')');
    return {bank:name, cards:cards.length, faults:faults};
  }
  var out = [], i = 0;
  function step(res){
    if (i >= BANKS.length){ res(JSON.stringify(out)); return; }
    var name = BANKS[i];
    var t = tabs().filter(function(x){ return x.textContent.trim()===name; })[0];
    if (!t){ out.push({bank:name, faults:['tab not found']}); i++; return step(res); }
    t.click();
    setTimeout(function(){
      out.push(audit(name));
      /* On CHORD also audit the widest case: every shape shown. */
      if (name === 'CHORD'){
        var fc = [].slice.call(document.querySelector('.pane').children)
          .filter(function(c){ return ((c.querySelector('.k')||{}).textContent||'')==='Shape Family'; })[0];
        var ext = fc && [].slice.call(fc.querySelectorAll('button'))
          .filter(function(b){ return b.textContent==='ext'; })[0];
        if (ext){ ext.click();
          setTimeout(function(){ out.push(audit('CHORD+ext')); i++; step(res); }, 900);
          return; }
      }
      i++; step(res);
    }, 900);
  }
  return new Promise(function(res){ setTimeout(function(){ step(res); }, 1400); });
})()
""" % json.dumps(BANKS)


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "move.local"
    sizes = [(1180, 690), (1180, 560), (1024, 700), (820, 620)]
    for a in sys.argv[2:]:
        if a.startswith("--sizes="):
            sizes = [tuple(int(x) for x in s.split("x"))
                     for s in a.split("=", 1)[1].split(",")]
    url = ("http://%s:7700/api/remote-ui/module-assets/stacks/"
           "web_ui.html?component=midi_fx1" % host)

    bad = 0
    for (w, h) in sizes:
        res = cdp(url, w, h, AUDIT)
        for r in res:
            if r["faults"]:
                bad += len(r["faults"])
                for f in r["faults"]:
                    print("FAIL %dx%d %-10s %s" % (w, h, r["bank"], f))
            else:
                print("ok   %dx%d %-10s %d cards" % (w, h, r["bank"], r.get("cards", 0)))
    if bad:
        print("\n%d layout fault(s)" % bad)
        return 1
    print("\nno layout faults across %d sizes x %d views" % (len(sizes), len(BANKS) + 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
