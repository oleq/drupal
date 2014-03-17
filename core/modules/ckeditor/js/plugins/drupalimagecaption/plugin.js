/**
 * @file
 * Drupal Image Caption plugin.
 *
 * Integrates the Drupal Image plugin with the caption_filter filter if enabled.
 */

(function( CKEDITOR ) {
  'use strict';

  var placeholderText = Drupal.t( 'Enter caption here' );

  CKEDITOR.plugins.add( 'drupalimagecaption', {
    requires: 'widget,drupalimage,image2',

    beforeInit: function( editor ) {
      // Disable default placeholder text that comes with CKEditor.
      editor.lang.image2.captionPlaceholder = '';

      // Cache classes used to set widget alignment.
      var alignClasses = editor.config.image2_alignClasses;

      // Override the image2 widget definition.
      editor.on( 'widgetDefinition', function( evt ) {
        var def = evt.data;

        if ( def.name != 'image' )
          return;

        // Overwrite default features definitions to match drupalimagecaption
        // data standard.
        CKEDITOR.tools.extend( def.features, {
          caption: {
            requiredContent: 'img[data-caption]'
          },
          align: {
            requiredContent: 'img[data-align]'
          }
        }, true );

        // Depending on a case, we have to downcast an image tag
        // or full figure+img+figcaption.
        def.downcast = function( element ) {
          // Find an image element in the one being downcasted (it can be itself).
          var img = findElementByName( element, 'img' ),
            caption = this.editables.caption,
            captionHtml = caption && caption.getData(),
            attrs = img.attributes;

          // If image contains a non-empty caption, serialize caption's data to the attribute.
          if ( captionHtml )
            attrs[ 'data-caption' ] = captionHtml;
          if ( this.data.align != 'none' )
            attrs[ 'data-align'] = this.data.align;
          attrs[ 'data-editor-file-uuid' ] = this.data[ 'data-editor-file-uuid' ];

          return img;
        };

        // We want to upcast <img> element to a DOM structure required
        // by the image2 widget. Depending on a case it may be:
        // * just an <img> tag (non-captioned, not-centered image),
        // * <img> tag in a paragraph (non-captioned, centered image),
        // * <figure> tag (captioned image).
        def.upcast = function( element, data ) {
          if ( element.name != 'img' )
            return;

          var attrs = element.attributes,
            caption = attrs[ 'data-caption' ],
            align = attrs[ 'data-align' ],
            retElement = element;

          // We won't need those attributes during editing,
          // because we're using widget.data to store them.
          data[ 'data-editor-file-uuid' ] = attrs[ 'data-editor-file-uuid' ];
          delete attrs[ 'data-caption' ];
          delete attrs[ 'data-align' ];
          delete attrs[ 'data-editor-file-uuid' ];

          // Unwrap from <p> wrapper created by HTML parser for captioned image.
          // Captioned image will be transformed to <figure>, so we don't want the <p> anymore.
          if ( element.parent.name == 'p' && caption ) {
            var index = element.getIndex(),
                splitBefore = index > 0,
                splitAfter = index + 1 < element.parent.children.length;

            if ( splitBefore )
              element.parent.split( index );

            index = element.getIndex();

            if ( splitAfter )
              element.parent.split( index + 1 );

            element.parent.replaceWith( element );
          }

          // If data-caption attribute was found create a full figure structure.
          if ( caption ) {
            var figure = retElement = new CKEDITOR.htmlParser.element( 'figure' );
            caption = new CKEDITOR.htmlParser.fragment.fromHtml( caption, 'figcaption' );

            // Use Drupal's data-placeholder attribute to insert a CSS-based,
            // translation-ready placeholder for empty captions. Note that it
            // also got to be done for new instances (see createDialogSaveCallback).
            caption.attributes[ 'data-placeholder' ] = placeholderText;

            element.replaceWith( figure );
            figure.add( element );
            figure.add( caption );
            figure.attributes[ 'class' ] = 'caption';
          }

          // If image does not have a caption, but it is centered, make sure
          // that it's wrapped with <p> which will become a part of widget.
          if ( align == 'center' && !caption ) {
              var p = retElement = new CKEDITOR.htmlParser.element( 'p' );
              element.replaceWith( p );
              p.add( element );
              // Apply the class for centered images.
              p.addClass( alignClasses[ 1 ] );
          }

          // Pass alignment to widget data.
          data.align = align;

          // Return the upcasted element (<img>, <figure> or <p>).
          return retElement;
        };

        // Override image2's ACF integration.
        def.allowedContent = 'img[!src,alt,width,height,data-align,data-caption,data-editor-file-uuid]';
        def.requiredContent = 'img[src]';
        def.editables.caption.allowedContent = 'br em strong sub sup u s; a[!href,target]';
      } );
    },

    init: function( editor ) {
      // Add a widget#edit listener to every instance of image2 widget
      // in order to handle its editing with Drupal's dialog.
      // This includes also a case just after the image was created
      // and dialog should be opened for it for the first time.
      editor.widgets.on( 'instanceCreated', function( evt ) {
        var widget = evt.data,
          firstEdit = true;

        if ( widget.name != 'image' )
          return;

        widget.on( 'edit', function( evt ) {
          // Cancel edit event to break image2's dialog binding
          // (and also to prevent automatic insertion before opening dialog).
          evt.cancel();

          // Open drupalimage dialog.
          editor.execCommand( 'editdrupalimage', {
            imageDOMElement: widget.parts.image.$,
            existingValues: widgetDataToDialogValues( widget.data ),
            saveCallback: createDialogSaveCallback( editor, widget ),
            dialogTitle: widget.data.src ? editor.config.drupalImage_dialogTitleEdit : editor.config.drupalImage_dialogTitleAdd
          } );
        } );
      } );
    },

    // Use afterInit, because CKEditor does not guarantee that drupalimage's init
    // method will be executed before this plugin's one.
    afterInit: function( editor ) {
      // Forward drupalimage command to image2, so for example
      // drupalimage button will insert image2 widget.
      editor.getCommand( 'drupalimage' ).on( 'exec', function( evt ) {
        evt.cancel();
        editor.execCommand( 'image' );
      } );
    }
  } );

  function createDialogSaveCallback( editor, widget ) {
    // Return cached callback.
    if ( widget._.saveCallback )
      return widget._.saveCallback;

    return widget._.saveCallback = function( returnValues ) {
      var firstEdit = !widget.ready;

      // Dialog may have blurred the widget. Re-focus it first.
      if ( !firstEdit )
        widget.focus();

      editor.fire( 'saveSnapshot' );

      // Set the updated widget data.
      // Note: on widget#setData this widget instance might be destroyed.
      var attrs = returnValues.attributes,
        // Pass true so DocumentFragment will also be returned.
        container = widget.wrapper.getParent( true ),
        image = widget.parts.image;

      widget.setData( {
        'data-editor-file-uuid': attrs[ 'data-editor-file-uuid' ],
        src: attrs.src,
        width: attrs.width,
        height: attrs.height,
        alt: attrs.alt,
        align: attrs.data_align || 'none',
        hasCaption: !!returnValues.hasCaption
      } );

      // Retrieve the widget once again. It could've been destroyed
      // when shifting state, so might deal with a new instance.
      widget = editor.widgets.getByElement( image );

      // It's first edit, just after widget instance creation, but before it was inserted into DOM.
      // So we need to retrieve the widget wrapper from inside the DocumentFragment which
      // we cached above and finalize other things (like ready event and flag).
      if ( firstEdit )
        editor.widgets.finalizeCreation( container );

      // By default, the template of captioned widget has no data-placeholder attribute.
      // Make sure that it is set for new instances, as well as when upcasting existing elements
      // (see def#upcast).
      if ( returnValues.hasCaption )
        widget.editables.caption.setAttribute( 'data-placeholder', placeholderText );

      setTimeout( function() {
        // (Re-)focus the widget.
        widget.focus();
        // Save snapshot for undo support.
        editor.fire( 'saveSnapshot' );
      } );
    };
  }

  // Transforms widget's data object to the format used by the drupalimage dialog.
  function widgetDataToDialogValues( data ) {
    return CKEDITOR.tools.extend( {}, data, {
      data_align: data.align
    }, true );
  }

  // Finds an element by its name. Function will check
  // first the passed element itself and then all its children in DFS order.
  // @param {CKEDITOR.htmlParser.element} element
  // @param {String} name
  // @returns {CKEDITOR.htmlParser.element}
  function findElementByName( element, name ) {
    if ( element.name == name )
      return element;

    var found = null;

    element.forEach( function( el ) {
      if ( el.name == name ) {
        found = el;
        return false; // Stop here.
      }
    }, CKEDITOR.NODE_ELEMENT );

    return found;
  }
})( CKEDITOR );