define(function (require, exports, module) {
    "use strict";

    var KeyBindingManager = brackets.getModule("command/KeyBindingManager"),
        Menus             = brackets.getModule("command/Menus"),
        KeyEvent          = brackets.getModule("utils/KeyEvent"),
        StringUtils       = brackets.getModule("utils/StringUtils"),
        ValidationUtils   = brackets.getModule("utils/ValidationUtils"),
        ViewUtils         = brackets.getModule("utils/ViewUtils"),
        PopUpManager      = brackets.getModule("widgets/PopUpManager"),
        Mustache          = brackets.getModule("thirdparty/mustache/mustache");

    var WidgetHTML  = require("text!./widget-list.html");

    function Widget(editor) {
        this.options = [];
        this.selectedIndex = -1;
        this.opened = false;
        this.editor = editor;
        this.handleSelect = null;
        this.handleClose = null;

        this.$widgetMenu =
            $("<li class='dropdown codehint-menu'></li>")
                .append($("<a href='#' class='dropdown-toggle' data-toggle='dropdown'></a>")
                        .hide())
                .append("<ul class='dropdown-menu'><p style='text-align: center; margin: 0; padding: 3px; background-color: #E0E0E0'>Choose Destination Scope</p></ul>");

        this._keydownHook = this._keydownHook.bind(this);
    }

    Widget.prototype._setSelectedIndex = function (index) {
        var items = this.$widgetMenu.find("li");

        // Range check
        index = Math.max(-1, Math.min(index, items.length - 1));

        // Clear old highlight
        if (this.selectedIndex !== -1) {
            $(items[this.selectedIndex]).find("a").removeClass("highlight");
        }

        this.selectedIndex = index;

        // Highlight the new selected item, if necessary
        if (this.selectedIndex !== -1) {
            var $item = $(items[this.selectedIndex]);
            var $view = this.$widgetMenu.find("ul.dropdown-menu");

            $item.find("a").addClass("highlight");
            ViewUtils.scrollElementIntoView($view, $item, false);
        }
    };

    Widget.prototype._buildListView = function (options) {
        var self            = this,
            view            = { options: [] },
            _addHint;

        this.options = options;

        _addHint = function (option) {
            view.options.push({ formattedOption: "<span>" + option.name + "</span>"});
        };

        // clear the list
        this.$widgetMenu.find("li").remove();

        // if there are no hints then close the list; otherwise add them and
        // set the selection
        if (this.options.length === 0) {
            if (this.handleClose) {
                this.handleClose();
            }
        } else {
            this.options.some(function (item, index) {
                _addHint(item);
            });

            // render code hint list
            var $ul = this.$widgetMenu.find("ul.dropdown-menu"),
                $parent = $ul.parent();

            $ul.remove().append(Mustache.render(WidgetHTML, view));

            $ul.children("li").each(function (index, element) {
                var option      = self.options[index],
                    $element    = $(element);

                $element.data("optionid", option.id);
            });

            $ul.on("click", "li", function (e) {
                e.stopPropagation();
                if (self.handleSelect) {
                    self.handleSelect($(this).data("optionid"));
                }
            });

            $parent.append($ul);

            this._setSelectedIndex(0);
        }
    };

    Widget.prototype._calcHintListLocation = function () {
        var cursor      = this.editor._codeMirror.cursorCoords(),
            posTop      = cursor.bottom,
            posLeft     = cursor.left,
            textHeight  = this.editor.getTextHeight(),
            $window     = $(window),
            $menuWindow = this.$widgetMenu.children("ul"),
            menuHeight  = $menuWindow.outerHeight();

        var bottomOverhang = posTop + menuHeight - $window.height();
        if (bottomOverhang > 0) {
            posTop -= (textHeight + 2 + menuHeight);
        }

        posTop -= 30;   // shift top for hidden parent element

        var menuWidth = $menuWindow.width();
        var availableWidth = menuWidth;
        var rightOverhang = posLeft + menuWidth - $window.width();
        if (rightOverhang > 0) {
            posLeft = Math.max(0, posLeft - rightOverhang);
        }

        return {left: posLeft, top: posTop, width: availableWidth};
    };


    Widget.prototype.isHandlingKeyCode = function (keyCodeOrEvent) {
        var keyCode = typeof keyCodeOrEvent === "object" ? keyCodeOrEvent.keyCode : keyCodeOrEvent;
        var ctrlKey = typeof keyCodeOrEvent === "object" ? keyCodeOrEvent.ctrlKey : false;


        return (keyCode === KeyEvent.DOM_VK_UP || keyCode === KeyEvent.DOM_VK_DOWN ||
                keyCode === KeyEvent.DOM_VK_PAGE_UP || keyCode === KeyEvent.DOM_VK_PAGE_DOWN ||
                keyCode === KeyEvent.DOM_VK_RETURN ||
                keyCode === KeyEvent.DOM_VK_CONTROL ||
                keyCode === KeyEvent.DOM_VK_ESCAPE
                );
    };

    Widget.prototype._keydownHook = function (event, isFakeKeydown) {
        var keyCode,
            self = this;

        // positive distance rotates down; negative distance rotates up
        function _rotateSelection(distance) {
            var len = self.options.length,
                pos;

            if (self.selectedIndex < 0) {
                // set the initial selection
                pos = (distance > 0) ? distance - 1 : len - 1;

            } else {
                // adjust current selection
                pos = self.selectedIndex;

                // Don't "rotate" until all items have been shown
                if (distance > 0) {
                    if (pos === (len - 1)) {
                        pos = 0;  // wrap
                    } else {
                        pos = Math.min(pos + distance, len - 1);
                    }
                } else {
                    if (pos === 0) {
                        pos = (len - 1);  // wrap
                    } else {
                        pos = Math.max(pos + distance, 0);
                    }
                }
            }

            self._setSelectedIndex(pos);
        }

        // Calculate the number of items per scroll page.
        function _itemsPerPage() {
            var itemsPerPage = 1,
                $items = self.$widgetMenu.find("li"),
                $view = self.$widgetMenu.find("ul.dropdown-menu"),
                itemHeight;

            if ($items.length !== 0) {
                itemHeight = $($items[0]).height();
                if (itemHeight) {
                    // round down to integer value
                    itemsPerPage = Math.floor($view.height() / itemHeight);
                    itemsPerPage = Math.max(1, Math.min(itemsPerPage, $items.length));
                }
            }

            return itemsPerPage;
        }

        // If we're no longer visible, skip handling the key and end the session.
        if (!this.isOpen()) {
            this.handleClose();
            return false;
        }

        // (page) up, (page) down, enter and tab key are handled by the list
        if ((event.type === "keydown" || isFakeKeydown) && this.isHandlingKeyCode(event)) {
            keyCode = event.keyCode;

            if (event.keyCode === KeyEvent.DOM_VK_ESCAPE) {
                event.stopImmediatePropagation();
                this.handleClose();

                return false;
            } else if (event.shiftKey &&
                    (event.keyCode === KeyEvent.DOM_VK_UP ||
                     event.keyCode === KeyEvent.DOM_VK_DOWN ||
                     event.keyCode === KeyEvent.DOM_VK_PAGE_UP ||
                     event.keyCode === KeyEvent.DOM_VK_PAGE_DOWN)) {
                this.handleClose();
                // Let the event bubble.
                return false;
            } else if (keyCode === KeyEvent.DOM_VK_UP) {
                _rotateSelection.call(this, -1);
            } else if (keyCode === KeyEvent.DOM_VK_DOWN ||
                    (event.ctrlKey && keyCode === KeyEvent.DOM_VK_SPACE)) {
                _rotateSelection.call(this, 1);
            } else if (keyCode === KeyEvent.DOM_VK_PAGE_UP) {
                _rotateSelection.call(this, -_itemsPerPage());
            } else if (keyCode === KeyEvent.DOM_VK_PAGE_DOWN) {
                _rotateSelection.call(this, _itemsPerPage());
            } else if (this.selectedIndex !== -1 &&
                    (keyCode === KeyEvent.DOM_VK_RETURN ||
                    (keyCode === KeyEvent.DOM_VK_TAB && this.insertHintOnTab))) {

                $(this.$widgetMenu.find("li")[this.selectedIndex]).trigger("click");
            } else {
                return false;
            }

            event.stopImmediatePropagation();
            event.preventDefault();
            return true;
        }

        return false;
    };

    Widget.prototype.isOpen = function () {
        if (this.opened && !this.$widgetMenu.hasClass("open")) {
            this.opened = false;
        }

        return this.opened;
    };

    Widget.prototype.open = function (options) {
        Menus.closeAll();

        this._buildListView(options);

        if (this.options.length) {
            // Need to add the menu to the DOM before trying to calculate its ideal location.
            $("#widget-menu-bar > ul").append(this.$widgetMenu);

            var hintPos = this._calcHintListLocation();

            this.$widgetMenu.addClass("open")
                .css({"left": hintPos.left, "top": hintPos.top, "width": hintPos.width + "px"});
            this.opened = true;

            KeyBindingManager.addGlobalKeydownHook(this._keydownHook);
        }
    };

    Widget.prototype.callMoveUp = function (event) {
        this._keydownHook(event, true);
    };

    Widget.prototype.close = function () {
        this.opened = false;

        if (this.$widgetMenu) {
            this.$widgetMenu.removeClass("open");
            PopUpManager.removePopUp(this.$widgetMenu);
            this.$widgetMenu.remove();
        }

        KeyBindingManager.removeGlobalKeydownHook(this._keydownHook);
    };

    Widget.prototype.onSelect = function (callback) {
        this.handleSelect = callback;
    };

    Widget.prototype.onClose = function (callback) {
        this.handleClose = callback;
    };

    exports.Widget = Widget;
});
