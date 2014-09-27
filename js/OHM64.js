outlets = 0;
inlets = 1;

BUTTON_OFF = 0;
BUTTON_ON = 1;

var Ohm64 = function (patcher) {
    
    /**
     * The parent patcher
     *
     * @var Patcher
     */
    this.patcher = patcher;

    /**
     * The global view function for all buttons. This can be overriden
     * for specific buttons
     * 
     * @var string
     */
    this.viewFunction;

    /**
     * An array containing the button states
     * 
     * @var array[Ohm64_Button]
     */
    this.buttonStates;

    /**
     * The interface that handles sending messages to the Ohm64
     * 
     * @var midiout 
     */
    this.midiInterface;

    /**
     * Initialize the object
     */
    this.init = function () {
        this.setMidiInterface(this.patcher.getnamed('toOhm64'));
        this.setViewFunction(Ohm64_Button.VIEW_TRIGGER);
    };

    /**
     * The button event. Triggered when a button is
     * pressed on the Ohm64
     *  
     * @param integer buttonId The ID of the button
     * @param interger value The state of the button
     */
    this.buttonPress = function (buttonId, state) {
        this.getButton(buttonId).press(state);
        this.sync();
    };

    /**
     * Retrieve a button object
     * 
     * @param interger buttonId The button ID
     * 
     * @returns Ohm64_Button
     */
    this.getButton = function (buttonId) {
        if (this.buttonStates[buttonId] === undefined) {
            this.buttonStates[buttonId] = new Ohm64_Button(this, buttonId, this.viewFunction);
        };
        
        return this.buttonStates[buttonId];
    };

    /**
     * Set the midi interface (the Max object that will send the messages to the device)
     *
     * @param MaxObject
     */
    this.setMidiInterface = function (midiInterface) {
        this.midiInterface = midiInterface;
    };

    /**
     * Set the global view function. This will get applied to all buttons
     *
     * @param string viewFunction The view function
     */
    this.setViewFunction = function (viewFunction) {
        var views = [Ohm64_Button.VIEW_TOGGLE, Ohm64_Button.VIEW_TRIGGER, Ohm64_Button.VIEW_BLINK];
        if (views.indexOf(viewFunction) === -1) {
            error(functionName + ' is not a valid view function');
            return;
        }

        this.viewFunction = viewFunction;
        this.clear();
    };

    /**
     * Set the state of all the buttons
     *
     * @param array states a list of the states (ON or OFF)
     */
    this.setStatesFromArray = function (states) {
        // Validate the input
        if (states.length !== 64) {
            error('Invalid list. See help for the list reference');
            return;
        }
            
        // Update the button states
        for(var i = 0; i < states.length; i++) {
            this.getButton(i).state = Boolean(states[i]);
        }
        
        this.sync();
    };

    /**
     * Sync the states of the buttons on the Ohm64. This uses a sysex command
     * to update all the buttons at once. This is done using bits to determine
     * which should be on or off. For the full documentation see 
     * http://wiki.lividinstruments.com/wiki/Ohm64
     */
    this.sync = function () {
        var sysexCommand = [240, 0, 1, 97, 2, 4]; 
        for (var i=0; i < this.OHM64_INDEX_MASK.length; i++) {
            var checksum = this.getColumnChecksum(i);
            sysexCommand.push(checksum.LL, checksum.HH);
        }
        
        sysexCommand.push(247);
        
        this.midiInterface.message(sysexCommand);
    };

    this.getColumnChecksum = function (column) {
        var indexMask = this.OHM64_INDEX_MASK[column];
        var LL = 0;
        var HH = 0;
        var exponent = 0;
        
        // There are 14 rows per column
        for (var i=0; i < indexMask.length; i++) {
            var index = indexMask[i];
            var isSet = (index === null) ? false : this.getButton(index).state;
            var columnValue = Math.pow(2, exponent) * !isSet;

            if (i < 7) {
                LL += columnValue;
            } else {
                HH += columnValue;
            }
            
            // Reset the exponent after the 7th value
            if (i === 6) {
                exponent = 0;
            } else {
                exponent++;
            }
        }
        
        return {LL: LL, HH: HH};
    };

    /**
     * Trigger a factory reset on the Ohm64
     */
    this.factoryReset = function () {
        var reset = [240, 0, 1, 97, 2, 6, 247];
        this.midiInterface.message(reset);
    };

    /**
     * Clear a button. If no button is specified, clear them all
     *
     * @param integer buttonId The Id of the button to clear (optional)
     */
    this.clear = function (buttonId) {
        if (buttonId !== undefined) {
            if (!parseInt(buttonId)) {
                error("clear: buttonId must be an integer");
                return;
            }

            this.getButton(buttonId).clear();
            this.buttonStates.splice(buttonId, 1);
        } else {
            for (index in this.buttonStates) {
                this.getButton(index).clear();
            }

            this.buttonStates = [];
        }

        this.sync();
    };

    /**
     * This array hold the order in which the rows and columns need
     * be added to get the correct LL HH values
     * 
     * @var array
     */
    this.OHM64_INDEX_MASK = [
        [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, null, 60, null, null],
        [1, 7, 13, 19, 25, 31, 37, 43, 49, 55, null, 61, null, null],
        [2, 8, 14, 20, 26, 32, 38, 44, 50, 56, null, 62, null, null],
        [3, 9, 15, 21, 27, 33, 39, 45, 51, 57, null, 63, null, null],
        [4, 10, 16, 22, 28, 34, 40, 46, 52, 58, null, null, null, null],
        [5, 11, 17, 23, 29, 35, 41, 47, 53, 59, null, null, null, null]
    ];

    // Initialize the Ohm64
    this.init();
};

var Ohm64_Button = function (Ohm64, buttonId, viewFunctionName) {

    /**
     * Initialize the object
     */
    this.init = function () {    
        this.Ohm64 = Ohm64;
        this.buttonId = buttonId;
        this.state = BUTTON_OFF;
        this.setViewFunction(viewFunctionName);
        this.isBlinking = false;
        this.setBlinkSpeed(100);
        this.blinkTask = null;
    }

    /**
     * The actions to take when the button is pressed
     *
     * @param integer state Is the button being pressed or released? 
     *                      (0 = released, non-0 = pressed)
     */
     this.press = function (state) {
        this.viewFunction(state);
     };

     /**
     * Set the View function. This is the function that will run when the button is pressed
     * 
     * @param string functionName The name of the function to use (must be one of this.VIEW_*)
     */
    this.setViewFunction = function (functionName) {
        var viewFunctionMap = {
            toggle: this.viewToggle,
            trigger: this.viewTrigger,
            blink: this.viewBlink
        };

        if (!viewFunctionMap[functionName]) {
            error(functionName + ' is not a valid view function');
            return;
        }

        this.viewFunction = viewFunctionMap[functionName];
    };

    /**
     * With this view, the button will toggle between light and unlight on
     * on each press
     * 
     * @param boolean isKeyDown Only trigger state change on button down events (default: true)
     */
    this.viewToggle = function (isKeyDown) { 
        // Only toggle state on button down
        if (!isKeyDown) {
            return;
        }

        // Toggle the state
        this.state = (this.state > 0) ? 0 : 1;
    };

    /**
     * With this view, the button will light up while it is pressed
     * 
     * @param integer state The state of the button 
     */
    this.viewTrigger = function (state) {
        this.state = state;
    };

    /**
     * With this view, the button will blink on and off. Alternating presses
     * start and stop the blinking
     * 
     * @param boolean isKeyDown Only trigger state change on button down events
     */
    this.viewBlink = function (isKeyDown) {  
        // Only toggle state on button down
        if (!isKeyDown) {
            return;
        }

        if (!this.isBlinking) {
            this.blinkTask = new Task(
                function () {
                    this.viewToggle(true);
                    this.Ohm64.sync(); 
                },
                this
            );
            this.blinkTask.interval = this.blinkSpeed;
            this.blinkTask.repeat();
            this.isBlinking = true;
        } else {
            this.cancelBlink();
            this.state = 0;
        }
    };

    /**
     * Cancel the blinking of a button. The state of the button will not be affected
     */
    this.cancelBlink = function () {
        if (this.blinkTask) {
            this.blinkTask.cancel();
        }

        this.isBlinking = false;
    };

    /**
     * Set the blink speed
     *
     * @param integer blinkSpeed The speed of the blinking
     */
    this.setBlinkSpeed = function (blinkSpeed) {
        this.blinkSpeed = blinkSpeed;

        if (this.blinkTask) {
            this.blinkTask.interval = blinkSpeed;
        }
    };

    /**
     * Completely clear the button (put it back to a clean state)
     */
    this.clear = function() {
        this.cancelBlink();        
        this.state = BUTTON_OFF;
        this.midiFunction = null;
        this.isBlinking = null;
        this.blinkTask = null;
    };

    this.init();
};

// Define the static view constants
Ohm64_Button.VIEW_TRIGGER = 'trigger';
Ohm64_Button.VIEW_TOGGLE = 'toggle';
Ohm64_Button.VIEW_BLINK = 'blink';

/*******************************************************************/

var Ohm64_Controller = new Ohm64(this.patcher);

// Here are the available messages this object can receive
function init() {Ohm64_Controller.init();}
function clear() {Ohm64_Controller.clear();}
function setViewFunction(viewFunction) {Ohm64_Controller.setViewFunction(viewFunction); }
function setBlinkSpeed(blinkSpeed) {Ohm64_Controller.setBlinkSpeed(blinkSpeed);}
function factoryReset() {Ohm64_Controller.factoryReset();}
function list() {Ohm64_Controller.setStatesFromArray(arguements);}
function button(buttonId, state) {Ohm64_Controller.buttonPress(buttonId, state);}