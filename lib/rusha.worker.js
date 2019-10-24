(function () {

  var log = function(str) {
      postMessage({msg: str});
  };

  var hasher = new Rusha();
  self.onmessage = function onMessage (event) {
    try {
      postMessage({id: event.data.id, hash: hasher.digest(event.data.data, function(progress) {
        postMessage({id: event.data.id, progress: progress});
      })});

    } catch(error) {
      postMessage({id: event.data.id, error: JSON.stringify(error)});
    }
  };

  // The Rusha object is a wrapper around the low-level RushaCore.
  // It provides means of converting different inputs to the
  // format accepted by RushaCore as well as other utility methods.
  function Rusha () {
    "use strict";

    var blockSize = 1024 * 1024 * 2; // must be a power of 2
    // Private object structure.
    var self = {fill: 0};

    var isBigIndian = function checkEndian(){
        var a = new ArrayBuffer(4);
        var b = new Uint8Array(a);
        var c = new Uint32Array(a);
        b[0] = 0xa1;
        b[1] = 0xb2;
        b[2] = 0xc3;
        b[3] = 0xd4;
        if(c[0] == 0xd4c3b2a1) {
          return false;
        }
        return true
    }();

    // Calculate the length of buffer that the sha1 routine uses
    // including the padding.
    var padlen = function (len) {
      return len + 1 + ((len ) % 64 < 56 ? 56 : 56 + 64) - (len ) % 64 + 8;
    };
    var padZeroes = function (bin, len) {
      for (var i = len >> 2; i < bin.length; i++) bin[i] = 0;
    };
    var padData = function (bin, len, realLen) {
      bin[len>>2] |= 0x80 << (24 - (len % 4 << 3));
      bin[(((len >> 2) + 2) & ~0x0f) + 14] = realLen >> 29;
      bin[(((len >> 2) + 2) & ~0x0f) + 15] = realLen << 3;
    };

    // Convert a binary string to a big-endian Int32Array using
    // four characters per slot and pad it per the sha1 spec.
    // A binary string is expected to only contain char codes < 256.
    var convStr = function (str, bin, len) {
      var i;
      for (i = 0; i < len; i = i + 4 |0) {
        bin[i>>2] = str.charCodeAt(i)   << 24 |
                    str.charCodeAt(i+1) << 16 |
                    str.charCodeAt(i+2) <<  8 |
                    str.charCodeAt(i+3);
      }
    };

    var copy = function(from, to) {
      var i;
      var len = (from.byteLength >> 2) << 2;
      for (i = 0; i < len; i = i + 4 |0) {
        to[i>>2] = from.getUint32(i, isBigIndian);
      }
      to[i>>2] = 0;
      for (; i< from.byteLength; i = i+1) {
        to[i>>2] |= from.getUint8(i) << ((3 - (i & 3)) * 8);
      }
      i+=4;
      for (; i < to.byteLength - 3; i = i + 4|0) {
        to[i>>2] = 0;
      }
    };

    // Convert a array containing 32 bit integers
    // into its hexadecimal string representation.
    var hex = function (binarray) {
      var i, x, hex_tab = "0123456789abcdef", res = [];
      for (i = 0; i < binarray.length; i++) {
        x = binarray[i];
        res[i] = hex_tab.charAt((x >> 28) & 0xF) +
                 hex_tab.charAt((x >> 24) & 0xF) +
                 hex_tab.charAt((x >> 20) & 0xF) +
                 hex_tab.charAt((x >> 16) & 0xF) +
                 hex_tab.charAt((x >> 12) & 0xF) +
                 hex_tab.charAt((x >>  8) & 0xF) +
                 hex_tab.charAt((x >>  4) & 0xF) +
                 hex_tab.charAt((x >>  0) & 0xF);
      }
      return res.join('');
    };

    var nextPow2 = function (v) {
      var p = 1; while (p < v) p = p << 1; return p;
    };

    // Resize the internal data structures to a new capacity.
    var resize = function (size) {
      self.sizeHint = size;
      self.heap     = new ArrayBuffer(nextPow2(padlen(size) + 320));
      self.core     = RushaCore({Int32Array: Int32Array}, {}, self.heap);
    };
    resize(Math.max(blockSize << 2, 4096));

    var coreInit = function (len) {
      var h = new Int32Array(self.heap, len << 2, 5);
      h[0] =  1732584193;
      h[1] =  -271733879;
      h[2] = -1732584194;
      h[3] =   271733878;
      h[4] = -1009589776;
      self.core.init(len);
    };
    // Initialize and call the RushaCore,
    // assuming an input buffer of length len * 4.
    var coreCall = function (len) {
      self.core.hash(len);
    };
    var coreFinalize = function (len) {
      self.core.end();
    };

    // Calculate the hash digest as an array of 5 32bit integers.
    var rawDigest = this.rawDigest = function (blob, progress) {
      coreInit(blockSize >> 2);

      var reader = new FileReaderSync();
      var i;
      var view = new Int32Array(self.heap, 0, blockSize >> 2);
      for (i=0; i < blob.size - blockSize; i += blockSize) {
        var dataView = new DataView(reader.readAsArrayBuffer(blob.slice(i, i + blockSize)));
        copy(dataView, view, isBigIndian);
        coreCall(view.length);
        progress(i);
        if (self.stopDigest) {
          throw "canceled";
        }
      }
      var buf = reader.readAsArrayBuffer(blob.slice(i, i + blockSize));
      var dataView = new DataView(buf);
      var len = dataView.byteLength || str.length;

      view = new Int32Array(self.heap, 0, padlen(len) >> 2);
      copy(dataView, view, isBigIndian);
      padData(view, len, blob.size);
      coreCall(view.length);
      coreFinalize();
      return new Int32Array(self.heap, 0, 5);
    };

    // The digest and digestFrom* interface returns the hash digest
    // as a hex string.
    this.digest = function (blob, progress) {
      return hex(rawDigest(blob, progress));
    };
  };

  // The low-level RushCore module provides the heart of Rusha,
  // a high-speed sha1 implementation working on an Int32Array heap.
  // At first glance, the implementation seems complicated, however
  // with the SHA1 spec at hand, it is obvious this almost a textbook
  // implementation that has a few functions hand-inlined and a few loops
  // hand-unrolled.
  function RushaCore (stdlib, foreign, heap) {
    "use asm";

    var H = new stdlib.Int32Array(heap);
    var i = 0, j = 0,
        y0 = 0, z0 = 0, y1 = 0, z1 = 0,
        y2 = 0, z2 = 0, y3 = 0, z3 = 0,
        y4 = 0, z4 = 0, t0 = 0, t1 = 0;

    function init (k) {
      k = k|0;
      i = j = y0 = z0 = y1 = z1 = y2 = z2 = y3 = z3 = y4 = z4 = t0 = t1 = 0;
      y0 = H[k+0<<2>>2]|0;
      y1 = H[k+1<<2>>2]|0;
      y2 = H[k+2<<2>>2]|0;
      y3 = H[k+3<<2>>2]|0;
      y4 = H[k+4<<2>>2]|0;
    }

    function end () {
      H[0] = y0;
      H[1] = y1;
      H[2] = y2;
      H[3] = y3;
      H[4] = y4;
    }

    function hash (k) {

      k = k|0;

      for (i = 0; (i|0) < (k|0); i = i + 16 |0) {

        z0 = y0;
        z1 = y1;
        z2 = y2;
        z3 = y3;
        z4 = y4;


        for (j = 0; (j|0) < 16; j = j + 1 |0) {
          t1 = H[i+j<<2>>2]|0;
          t0 = ((((y0) << 5 | (y0) >>> 27) + (y1 & y2 | ~y1 & y3) |0) + ((t1 + y4 | 0)  +1518500249 |0) |0);
          y4 = y3; y3 = y2; y2 = ((y1) << 30 | (y1) >>> 2); y1 = y0; y0 = t0;
          H[k+j<<2>>2] = t1;
        }

        for (j = k + 16 |0; (j|0) < (k + 20 |0); j = j + 1 |0) {
          t1 = (((H[j-3<<2>>2] ^ H[j-8<<2>>2] ^ H[j-14<<2>>2] ^ H[j-16<<2>>2]) << 1 | (H[j-3<<2>>2] ^ H[j-8<<2>>2] ^ H[j-14<<2>>2] ^ H[j-16<<2>>2]) >>> 31));
          t0 = ((((y0) << 5 | (y0) >>> 27) + (y1 & y2 | ~y1 & y3) |0) + ((t1 + y4 | 0)  +1518500249 |0) |0);
          y4 = y3; y3 = y2; y2 = ((y1) << 30 | (y1) >>> 2); y1 = y0; y0 = t0;
          H[j<<2>>2] = t1;
        }

        for (j = k + 20 |0; (j|0) < (k + 40 |0); j = j + 1 |0) {
          t1 = (((H[j-3<<2>>2] ^ H[j-8<<2>>2] ^ H[j-14<<2>>2] ^ H[j-16<<2>>2]) << 1 | (H[j-3<<2>>2] ^ H[j-8<<2>>2] ^ H[j-14<<2>>2] ^ H[j-16<<2>>2]) >>> 31));
          t0 = ((((y0) << 5 | (y0) >>> 27) + (y1 ^ y2 ^ y3) |0) + ((t1 + y4 | 0)  +1859775393 |0) |0);
          y4 = y3; y3 = y2; y2 = ((y1) << 30 | (y1) >>> 2); y1 = y0; y0 = t0;
          H[j<<2>>2] = t1;
        }

        for (j = k + 40 |0; (j|0) < (k + 60 |0); j = j + 1 |0) {
          t1 = (((H[j-3<<2>>2] ^ H[j-8<<2>>2] ^ H[j-14<<2>>2] ^ H[j-16<<2>>2]) << 1 | (H[j-3<<2>>2] ^ H[j-8<<2>>2] ^ H[j-14<<2>>2] ^ H[j-16<<2>>2]) >>> 31));
          t0 = ((((y0) << 5 | (y0) >>> 27) + (y1 & y2 | y1 & y3 | y2 & y3) |0) + ((t1 + y4 | 0)  -1894007588 |0) |0);
          y4 = y3; y3 = y2; y2 = ((y1) << 30 | (y1) >>> 2); y1 = y0; y0 = t0;
          H[j<<2>>2] = t1;
        }

        for (j = k + 60 |0; (j|0) < (k + 80 |0); j = j + 1 |0) {
          t1 = (((H[j-3<<2>>2] ^ H[j-8<<2>>2] ^ H[j-14<<2>>2] ^ H[j-16<<2>>2]) << 1 | (H[j-3<<2>>2] ^ H[j-8<<2>>2] ^ H[j-14<<2>>2] ^ H[j-16<<2>>2]) >>> 31));
          t0 = ((((y0) << 5 | (y0) >>> 27) + (y1 ^ y2 ^ y3) |0) + ((t1 + y4 | 0)  -899497514 |0) |0);
          y4 = y3; y3 = y2; y2 = ((y1) << 30 | (y1) >>> 2); y1 = y0; y0 = t0;
          H[j<<2>>2] = t1;
        }

        y0 = y0 + z0 |0;
        y1 = y1 + z1 |0;
        y2 = y2 + z2 |0;
        y3 = y3 + z3 |0;
        y4 = y4 + z4 |0;
      }
    }

    return {
      init: init,
      hash: hash,
      end: end
    };

  }

})();
