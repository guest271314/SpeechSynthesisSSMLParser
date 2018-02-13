    // SpeechSynthesisSSMLParser.js guest271314 12-17-2017
    // Motivation: Implement SSML parsing for Web Speech API
    // See https://lists.w3.org/Archives/Public/www-voice/2017OctDec/0000.html
    // https://github.com/guest271314/SpeechSynthesisSSMLParser
    class SpeechSynthesisSSMLParser {
      constructor(ssml) {
        console.log(this);
        this.ssml = ssml;
        this.queue = [];
        this.nodes = new Map(Object.entries({
          "break": this._break,
          "prosody": this.prosody,
          "#text": this.text,
          "voice": this.voice,
          "p": this.p,
          "s": this.s
        }));
        this.pitches = new Map(Object.entries({
          "x-low": 0.3333333333333333,
          "low": 0.6666666666666666,
          "default": 1,
          "medium": 1.3333333333333333,
          "high": 1.6666666666666665,
          "x-high": 1.9999999999999998
        }));
        this.rates = new Map(Object.entries({
          "x-slow": 0.1,
          "slow": 0.5,
          "default": 1,
          "medium": 2.5,
          "fast": 5,
          "x-fast": 10
        }));
        this.strengths = new Map(Object.entries({
          "none": 0,
          "x-weak": .125,
          "weak": .25,
          "medium": .5,
          "strong": 1,
          "x-strong": 2
        }));
        if (this.ssml && typeof this.ssml === "string") {
          this.ssml = (new DOMParser()).parseFromString(ssml, "application/xml");
        }
        if (this.ssml instanceof Document && this.ssml.documentElement.nodeName === "speak") {
          // handle `<break strength="none">`
          this.br();
          // handle `<sub>`
          this.sub();
          if (this.ssml.documentElement.attributes.getNamedItem("xml:lang").value.length) {
            if (this.ssml.documentElement.children.length === 0) {
              const utterance = new SpeechSynthesisUtterance(this.ssml.documentElement.textContent);
              this._queue({
                utterance
              });
            } else {
              for (let node of this.ssml.documentElement.childNodes) {
                Reflect.apply(this.nodes.get(node.nodeName), this, [{
                  node
                }])
              }
            }
          } else {
            throw new TypeError("Root element of SSML document should be <speak>")
          }
        } else {
          const utterance = new SpeechSynthesisUtterance(this.ssml = ssml);
          this._queue({
            utterance
          });
        }
      }
      prosody({
        node, voice
      }) {
        console.log("prosody", node);
        const utterance = new SpeechSynthesisUtterance();
        const [{
          pitch,
          rate
        }, text] = [
          [...node.attributes].reduce((o, {
            nodeName,
            nodeValue
          }) => Object.assign(o, {
            [nodeName]: this.pitches.get(nodeValue) || this.rates.get(nodeValue) || nodeValue
          }), Object.create(null)), node.textContent
        ];
        Object.assign(utterance, {
          pitch: pitch < 0 || pitch > 2 ? this.pitches.default : pitch,
          rate: rate < 0.1 || rate > 10 ? this.rates.default : rate,
          text,
          voice
        });
        this._queue({
          utterance
        });
      }
      voice({
        node
      }) {
        const [{
          name
        }, text] = [
          [...node.attributes].reduce((o, {
            nodeName,
            nodeValue
          }) => Object.assign(o, {
            [nodeName]: nodeValue
          }), Object.create(null)), node.textContent
        ];
        const names = SpeechSynthesisSSMLParser.voices.filter(({
          name: voiceName
        }) => voiceName.indexOf(name) > -1);
        if (node.children.length === 0) {
          const utterance = new SpeechSynthesisUtterance();
          console.log(names);
          Object.assign(utterance, {
            voice: names[0],
            text
          });
          this._queue({
            utterance
          });
        } else {
          for (let childNode of node.childNodes) {
            Reflect.apply(this.nodes.get(childNode.nodeName), this, [{
              node: childNode,
              voice: names[0]
            }]);
          }
        }
      }
      _break({
        node, _strength
      }) {
        let strength = !node 
                       ? _strength // handle `<p>` and `<s>` elements
                       : node.getAttribute("strength") 
                         ? this.strengths.get(node.getAttribute("strength")) 
                         : node.getAttribute("time") 
                           ? this.strengths.get("none") 
                           : this.strengths.get("medium");
        // handle "250ms", "3s"
        let time = node && node.getAttribute("time") 
                   ? node.getAttribute("time").match(/[\d.]+|\w+$/g)
                     .reduce((n, t) => Number(n) * (t === "s" ? 1 : .001)) 
                   : this.strengths.get("none");
        console.log(strength, time);
        // https://www.w3.org/TR/2010/REC-speech-synthesis11-20100907/#S3.2.3
        // "If both strength and time attributes are supplied, 
        // the processor will insert a break with a duration as specified by the time attribute, 
        // with other prosodic changes in the output based on the value of the strength attribute."
        if (!strength && !time) {
          strength = this.strengths.get("medium");
        }
        time += strength;
        console.log(time);
        this.queue.push(() => new Promise(resolve => {
          const context = new AudioContext();
          const ab = context.createBuffer(2, 44100 * time, 44100);
          const source = context.createBufferSource();
          source.buffer = ab;
          source.connect(context.destination);
          source.onended = (e) => {
            source.onended = null;
            context.close().then(resolve);
          }
          source.start(context.currentTime);
          source.stop(context.currentTime + time);
        }));
      }
      _queue({
        utterance
      }) {
        if (utterance && utterance instanceof SpeechSynthesisUtterance) {
          this.queue.push(() => new Promise(resolve => {
            utterance.onend = resolve;
            window.speechSynthesis.speak(
              utterance
            );
          }))
        }
      }
      text({
        node, voice
      }) {
        const utterance = new SpeechSynthesisUtterance(node.nodeValue);
        if (voice) {
          utterance.voice = voice;
        }
        if (utterance.text.trim()) {
          this._queue({
            utterance
          });
        }
      }
      sub() {
        const utterance = new SpeechSynthesisUtterance();
        // handle `<sub alias="Speech Synthesis Markup Language">SSML</sub>`
        // replace the element with `#text` node with `nodeValue` set to `alias` attribute value
        // https://www.w3.org/TR/2010/REC-speech-synthesis11-20100907/#edef_sub
        // "The sub element is employed to indicate that the text in the alias attribute value replaces the contained text for pronunciation. 
        // This allows a document to contain both a spoken and written form. 
        // The required alias attribute specifies the string to be spoken instead of the enclosed string. 
        // The processor should apply text normalization to the alias value."
        this.ssml.querySelectorAll("sub").forEach(sub => {
          const textNode = this.ssml.createTextNode(sub.getAttribute("alias"));
          sub.parentNode.replaceChild(textNode, sub);
        });
      }
      br() {
        // handle `<break strength="none"/>`
        // remove the element
        // https://www.w3.org/TR/2010/REC-speech-synthesis11-20100907/#S3.2.3
        // "The value "none" indicates that no prosodic break boundary should be outputted, 
        // which can be used to prevent a prosodic break which the processor would otherwise produce."
        this.ssml.querySelectorAll("break").forEach(br => {
          if (br.getAttribute("strength") === "none") {
            if (br.nextSibling && br.nextSibling.nodeName === "#text" && br.previousSibling 
                && br.previousSibling.nodeName === "#text") {
              br.previousSibling.nodeValue += br.nextSibling.nodeValue;
              br.parentNode.removeChild(br.nextSibling);
              br.parentNode.removeChild(br);
            } else {
              br.parentNode.removeChild(br);
            }
          }
        });
      }
      // handle `<p>` element
      // https://www.w3.org/TR/2010/REC-speech-synthesis11-20100907/#S3.1.8.1
      // "A p element represents a paragraph. An s element represents a sentence."
      // "The use of p and s elements is optional. Where text occurs without an enclosing p or s element 
      // the synthesis processor should attempt to determine the structure using language-specific knowledge of the format of plain text."
      // see also:
      // https://developer.amazon.com/docs/custom-skills/speech-synthesis-markup-language-ssml-reference.html#p
      // https://console.bluemix.net/docs/services/text-to-speech/SSML-elements.html#ps_element
      // https://developers.google.com/actions/reference/ssml#p+s
      // https://docs.microsoft.com/en-us/cortana/skills/speech-synthesis-markup-language#p-and-s-element
      p({
        node, voice
      }) {
        if (node.children.length === 0) {
          console.log(node.textContent);
          const utterance = new SpeechSynthesisUtterance(node.textContent);
          if (voice) {
            utterance.voice = voice;
          }
          // The specification does not explicitly define a pause in audio output before and after a `<p>` element.
          // this._break({_strength:this.strengths.get("weak")});
          this._queue({
            utterance
          });
          // this._break({_strength:this.strengths.get("weak")});
        } else {
          for (let childNode of node.childNodes) {
            Reflect.apply(this.nodes.get(childNode.nodeName), this, [{
              node: childNode,
              voice
            }]);
          }
        }
      }
      // handle `<s>` element
      // https://www.w3.org/TR/2010/REC-speech-synthesis11-20100907/#S3.1.8.1
      // "A p element represents a paragraph. An s element represents a sentence."
      // "The use of p and s elements is optional. Where text occurs without an enclosing p or s element 
      // the synthesis processor should attempt to determine the structure using language-specific knowledge of the format of plain text."
      // see also:
      // https://developer.amazon.com/docs/custom-skills/speech-synthesis-markup-language-ssml-reference.html#s
      // https://console.bluemix.net/docs/services/text-to-speech/SSML-elements.html#ps_element
      // https://developers.google.com/actions/reference/ssml#p+s
      // https://docs.microsoft.com/en-us/cortana/skills/speech-synthesis-markup-language#p-and-s-elements
      s({
        node, voice
      }) {
        if (node.children.length === 0) {
          console.log(node.textContent);
          const utterance = new SpeechSynthesisUtterance(node.textContent);
          if (voice) {
            utterance.voice = voice;
          }
          // The specification does not explicitly define a pause in audio output before and after a `<s>` element.
          // this._break({_strength:this.strengths.get("x-weak")});
          this._queue({
            utterance
          });
          // this._break({_strength:this.strengths.get("x-weak")});
        } else {
          for (let childNode of node.childNodes) {
            Reflect.apply(this.nodes.get(childNode.nodeName), this, [{
              node: childNode,
              voice
            }]);
          }
        }
      }
    }
