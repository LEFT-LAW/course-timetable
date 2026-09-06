/*
 * lib/xlsx.js — 纯 JS 只读 .xlsx 解析器（无任何依赖）
 *
 * 适用范围：.xlsx = ZIP 容器，内含若干 XML（workbook/sharedStrings/worksheets）。
 * 本模块内置：
 *   1) ZIP 中央目录解析（Stored / Deflate）
 *   2) RFC1951 Deflate 解压（inflate）
 *   3) 轻量 XML 解析
 *   4) 工作表 → { name, rows[行][列](文本), merges[] } 的归一化输出
 *
 * 浏览器（window.XlsxLib）与 Node（module.exports）通用。
 */
(function (root) {
  'use strict';

  /* ============================ Deflate inflate ============================ */
  var LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEN_EXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DIST_EXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var CLEN_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  function BitReader(u8) {
    this.u8 = u8;
    this.pos = 0; // 单位：位
  }
  BitReader.prototype.nextBit = function () {
    var b = (this.u8[this.pos >> 3] >> (this.pos & 7)) & 1;
    this.pos++;
    return b;
  };
  // deflate 中 BFINAL/BTYPE/HLIT/extra 等“普通整型字段”按 LSB 优先打包
  BitReader.prototype.readBitsLSB = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++) v |= this.nextBit() << i;
    return v;
  };

  // Huffman 树：由每个符号的码长数组，构建“逐位前缀查表”。
  // deflate 的哈夫曼码按 MSB 优先传输，因此读位时逐位左移累加，与规范码直接比对。
  function Huffman(lengths) {
    var maxLen = 0, i;
    for (i = 0; i < lengths.length; i++) if (lengths[i] > maxLen) maxLen = lengths[i];
    this.maxLen = maxLen;
    var bl = new Array(maxLen + 1).fill(0);
    for (i = 0; i < lengths.length; i++) if (lengths[i]) bl[lengths[i]]++;
    var next = new Array(maxLen + 1).fill(0);
    var code = 0;
    for (i = 1; i <= maxLen; i++) {
      code = (code + bl[i - 1]) << 1;
      next[i] = code;
    }
    this.levels = new Array(maxLen + 1);
    for (i = 0; i < lengths.length; i++) {
      var l = lengths[i];
      if (!l) continue;
      var c = next[l]++;
      if (!this.levels[l]) this.levels[l] = new Int16Array(1 << l).fill(-1);
      this.levels[l][c] = i;
    }
  }
  Huffman.prototype.decode = function (br) {
    var val = 0;
    for (var len = 1; len <= this.maxLen; len++) {
      val = (val << 1) | br.nextBit();
      var level = this.levels[len];
      if (level) {
        var s = level[val];
        if (s >= 0) return s;
      }
    }
    throw new Error('无效的霍夫曼码');
  };

  var FIXED_LIT, FIXED_DIST;
  function fixedTrees() {
    if (FIXED_LIT) return;
    var ll = new Array(288);
    var d = new Array(30).fill(5);
    var i;
    for (i = 0; i < 144; i++) ll[i] = 8;
    for (i = 144; i < 256; i++) ll[i] = 9;
    for (i = 256; i < 280; i++) ll[i] = 7;
    for (i = 280; i < 288; i++) ll[i] = 8;
    FIXED_LIT = new Huffman(ll);
    FIXED_DIST = new Huffman(d);
  }

  function buildCodeLenTree(br) {
    var hlit = br.readBitsLSB(5) + 257;
    var hdist = br.readBitsLSB(5) + 1;
    var hclen = br.readBitsLSB(4) + 4;
    var cl = new Array(19).fill(0);
    for (var i = 0; i < hclen; i++) cl[CLEN_ORDER[i]] = br.readBitsLSB(3);
    var clTree = new Huffman(cl);
    var lens = new Array(hlit + hdist);
    var i = 0;
    while (i < lens.length) {
      var sym = clTree.decode(br);
      if (sym < 16) {
        lens[i++] = sym;
      } else if (sym === 16) {
        var rep = br.readBitsLSB(2) + 3;
        if (i === 0) throw new Error('无效长度16');
        var prev = lens[i - 1];
        for (var j = 0; j < rep; j++) lens[i++] = prev;
      } else if (sym === 17) {
        var rep2 = br.readBitsLSB(3) + 3;
        for (var j2 = 0; j2 < rep2; j2++) lens[i++] = 0;
      } else {
        var rep3 = br.readBitsLSB(7) + 11;
        for (var j3 = 0; j3 < rep3; j3++) lens[i++] = 0;
      }
    }
    return {
      lit: new Huffman(lens.slice(0, hlit)),
      dist: new Huffman(lens.slice(hlit))
    };
  }

  function inflateRaw(u8) {
    var br = new BitReader(u8);
    var out = [];
    var push = function (b) { out[out.length] = b; };
    for (;;) {
      if (br.pos + 3 > u8.length * 8) throw new Error('数据截断');
      var bfinal = br.nextBit();
      var btype = br.readBitsLSB(2);
      var litTree, distTree;
      if (btype === 0) {
        // Stored：跳到字节边界
        var skip = (8 - (br.pos & 7)) & 7;
        for (var s = 0; s < skip; s++) br.nextBit();
        var byteStart = br.pos >> 3;
        var len = u8[byteStart] | (u8[byteStart + 1] << 8);
        for (var k = 0; k < len; k++) push(u8[byteStart + 2 + k]);
        br.pos += (len + 4) * 8;
      } else if (btype === 1) {
        fixedTrees();
        inflateBlock(br, FIXED_LIT, FIXED_DIST, out, push);
      } else if (btype === 2) {
        var t = buildCodeLenTree(br);
        inflateBlock(br, t.lit, t.dist, out, push);
      } else {
        throw new Error('保留的块类型 3');
      }
      if (bfinal) break;
    }
    return Uint8Array.from(out);
  }

  function inflateBlock(br, litTree, distTree, out, push) {
    for (;;) {
      var sym = litTree.decode(br);
      if (sym < 256) {
        push(sym);
      } else if (sym === 256) {
        return;
      } else {
        var li = sym - 257;
        var len = LEN_BASE[li] + br.readBitsLSB(LEN_EXT[li]);
        var dsym = distTree.decode(br);
        var dist = DIST_BASE[dsym] + br.readBitsLSB(DIST_EXT[dsym]);
        if (dist > out.length) throw new Error('距离超出已输出范围');
        var base = out.length - dist;
        for (var k = 0; k < len; k++) push(out[base + k]);
      }
    }
  }

  /* ================================ ZIP ==================================== */
  function readU16(u8, o) { return u8[o] | (u8[o + 1] << 8); }
  function readU32(u8, o) { return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0; }
  function decodeText(u8) {
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8').decode(u8); } catch (e) { /* 继续 */ }
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('utf8');
    var s = '', i = 0;
    while (i < u8.length) {
      var b = u8[i++];
      if (b < 0x80) s += String.fromCharCode(b);
      else if (b < 0xE0) s += String.fromCharCode(((b & 0x1F) << 6) | (u8[i++] & 0x3F));
      else if (b < 0xF0) s += String.fromCharCode(((b & 0x0F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F));
      else {
        var cp = ((b & 0x07) << 18) | ((u8[i++] & 0x3F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F);
        s += String.fromCodePoint(cp);
      }
    }
    return s;
  }

  function listZipEntries(u8) {
    var entries = [];
    var eocd = -1;
    var scanStart = Math.max(0, u8.length - 65557);
    for (var i = u8.length - 22; i >= scanStart; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4B && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 文件（找不到目录结尾）');
    var count = readU16(u8, eocd + 10);
    var cdOffset = readU32(u8, eocd + 16);
    var p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (readU32(u8, p) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
      var method = readU16(u8, p + 10);
      var compSize = readU32(u8, p + 20);
      var nameLen = readU16(u8, p + 28);
      var extraLen = readU16(u8, p + 30);
      var commentLen = readU16(u8, p + 32);
      var localOff = readU32(u8, p + 42);
      var name = decodeText(u8.slice(p + 46, p + 46 + nameLen));
      var dataStart = localOff;
      if (readU32(u8, localOff) === 0x04034b50) {
        var nameLenL = readU16(u8, localOff + 26);
        var extraLenL = readU16(u8, localOff + 28);
        dataStart = localOff + 30 + nameLenL + extraLenL;
      }
      var data = u8.slice(dataStart, dataStart + compSize);
      if (method === 8) data = inflateRaw(data);
      else if (method !== 0) throw new Error('不支持的压缩方式: ' + method);
      entries.push({ name: name, data: data });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  /* ============================== 轻量 XML ================================= */
  function decodeEntities(s) {
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, e) {
      if (e[0] === '#') {
        var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return String.fromCodePoint(n);
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] || m;
    });
  }
  // 返回 { tag, attrs:{}, children:[], text:'' }
  function parseXml(str) {
    var i = 0, n = str.length;
    function parseNode() {
      for (;;) {
        while (i < n && /\s/.test(str[i])) i++;
        if (str.startsWith('<?', i)) { i = str.indexOf('?>', i) + 2; continue; }
        if (str.startsWith('<!--', i)) { i = str.indexOf('-->', i) + 3; continue; }
        if (str.startsWith('<!', i)) { i = str.indexOf('>', i) + 1; continue; }
        break;
      }
      if (i >= n || str[i] !== '<') throw new Error('XML 解析错误 @' + i);
      i++;
      var tagStart = i;
      while (i < n && !/[\s/>]/.test(str[i])) i++;
      var tag = str.slice(tagStart, i);
      var attrs = {};
      var selfClose = false;
      for (;;) {
        while (i < n && /\s/.test(str[i])) i++;
        if (i >= n) throw new Error('XML 未闭合: ' + tag);
        var ch = str[i];
        if (ch === '>') { i++; break; }
        if (ch === '/' && str[i + 1] === '>') { selfClose = true; i += 2; break; }
        var aStart = i;
        while (i < n && !/[\s=/>]/.test(str[i])) i++;
        var aName = str.slice(aStart, i);
        while (i < n && /\s/.test(str[i])) i++;
        if (str[i] === '=') {
          i++;
          while (i < n && /\s/.test(str[i])) i++;
          var q = str[i];
          var vEnd = str.indexOf(q, i + 1);
          attrs[aName] = decodeEntities(str.slice(i + 1, vEnd));
          i = vEnd + 1;
        } else {
          attrs[aName] = '';
        }
      }
      var node = { tag: tag, attrs: attrs, children: [], text: '' };
      if (selfClose) return node;
      for (;;) {
        var lt = str.indexOf('<', i);
        if (lt < 0) { node.text += str.slice(i); i = n; break; }
        if (str.startsWith('</', lt)) {
          node.text += str.slice(i, lt);
          i = str.indexOf('>', lt) + 1;
          return node;
        }
        node.text += str.slice(i, lt);
        i = lt;
        node.children.push(parseNode());
      }
    }
    return parseNode();
  }
  function localName(tag) { var k = tag.indexOf(':'); return k >= 0 ? tag.slice(k + 1) : tag; }
  function childByLocal(node, name) {
    for (var i = 0; i < node.children.length; i++) {
      if (localName(node.children[i].tag) === name) return node.children[i];
    }
    return null;
  }
  function childrenByLocal(node, name) {
    var out = [];
    for (var i = 0; i < node.children.length; i++) {
      if (localName(node.children[i].tag) === name) out.push(node.children[i]);
    }
    return out;
  }
  function allText(node) {
    var s = node.text || '';
    for (var i = 0; i < node.children.length; i++) s += allText(node.children[i]);
    return s;
  }

  /* ================================ XLSX =================================== */
  function colIndex(ref) {
    var m = /^([A-Z]+)(\d+)$/.exec(ref);
    var c = 0;
    for (var i = 0; i < m[1].length; i++) c = c * 26 + (m[1].charCodeAt(i) - 64);
    return { col: c - 1, row: parseInt(m[2], 10) - 1 };
  }

  function parseSharedStrings(xml) {
    var root = parseXml(xml);
    var out = [];
    childrenByLocal(root, 'si').forEach(function (si) { out.push(allText(si)); });
    return out;
  }

  function parseSheetWithShared(xml, shared) {
    var root = parseXml(xml);
    var sheetData = childByLocal(root, 'sheetData');
    var rows = [];
    var merges = [];
    var mc = childByLocal(root, 'mergeCells');
    if (mc) {
      childrenByLocal(mc, 'mergeCell').forEach(function (m) { merges.push(m.attrs.ref); });
    }
    if (!sheetData) return { rows: rows, merges: merges };
    childrenByLocal(sheetData, 'row').forEach(function (row) {
      var rn = parseInt(row.attrs.r, 10);
      if (!rows[rn - 1]) rows[rn - 1] = [];
      childrenByLocal(row, 'c').forEach(function (c) {
        var pos = colIndex(c.attrs.r);
        var t = c.attrs.t;
        var text = '';
        if (t === 's') {
          var v = childByLocal(c, 'v');
          if (v) text = shared[parseInt(v.text, 10)] || '';
        } else if (t === 'inlineStr') {
          var is = childByLocal(c, 'is');
          if (is) text = allText(is);
        } else {
          var v2 = childByLocal(c, 'v');
          if (v2) text = v2.text;
        }
        rows[rn - 1][pos.col] = text;
      });
    });
    return { rows: rows, merges: merges };
  }

  // 主入口：bytes(Uint8Array) → { sheets: [{ name, rows, merges }] }
  function parseWorkbook(bytes) {
    var entries = listZipEntries(bytes);
    var byName = {};
    entries.forEach(function (e) { byName[e.name.replace(/\\/g, '/')] = e.data; });
    var get = function (p) {
      if (!byName[p]) throw new Error('缺少文件: ' + p);
      return decodeText(byName[p]);
    };
    var wb = parseXml(get('xl/workbook.xml'));
    var relTarget = {};
    var relXml = parseXml(get('xl/_rels/workbook.xml.rels'));
    childrenByLocal(relXml, 'Relationship').forEach(function (r) {
      relTarget[r.attrs.Id] = r.attrs.Target;
    });
    var shared = byName['xl/sharedStrings.xml'] ? parseSharedStrings(get('xl/sharedStrings.xml')) : [];
    var sheets = [];
    var wbSheets = childByLocal(wb, 'sheets');
    (wbSheets ? wbSheets.children : []).forEach(function (sh) {
      if (localName(sh.tag) !== 'sheet') return;
      var rid = sh.attrs['r:id'] || sh.attrs.id;
      var target = relTarget[rid] || ('worksheets/' + (sheets.length + 1) + '.xml');
      if (target.indexOf('/') !== 0 && target.indexOf(':') < 0 && target.indexOf('xl/') !== 0) target = 'xl/' + target;
      var s = parseSheetWithShared(get(target.replace(/^\//, '')), shared);
      sheets.push({ name: sh.attrs.name || ('Sheet' + (sheets.length + 1)), rows: s.rows, merges: s.merges });
    });
    return { sheets: sheets };
  }

  var api = {
    inflateRaw: inflateRaw,
    listZipEntries: listZipEntries,
    parseWorkbook: parseWorkbook,
    parseXml: parseXml
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XlsxLib = api;
})(typeof self !== 'undefined' ? self : this);
