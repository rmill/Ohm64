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
     * This array contains the map for converting a MIDI not into which
     * button was pressed on the Ohm64. This is necessary because the user
     * can configure any button to send any midi note but we always want 
     * to store the state of the button.
     *
     * ex. The top left button (0) may send MIDI note 46 but we want to
     * store that the stae of button 0 is 'pressed' (regardless of the MIDI
     * note that was sent to signify its being pressed)
     */
    this.midiButtonMap;

    /**
     * This task constantly re-renders the display
     *
     * @var Task
     */
    this.renderTask;

    /**
     * The global blink speed in miliseconds. This will be used as the default when a 
     * button is pressed
     *
     * @var integer
     */
     this.blinkSpeed;

    /**
     * Initialize the object
     */
    this.init = function () {
        this.setMidiInterface(this.patcher.getnamed('toOhm64'));
        this.setViewFunction(Ohm64_Button.VIEW_TRIGGER);
        this.requestMidiButtonMap();
        this.blinkSpeed = 100;

        this.sync();
    };

    this.renderStart = function () {
        if (this.renderTask) {
            return;
        } 

        this.renderTask = new Task(
            function () {
                this.sync();
            },
            this
        );
        this.renderTask.interval = 10;
        this.renderTask.repeat();
    };

    this.renderStop = function ()  {
        if (this.renderTask) {
            this.renderTask.cancel();
            delete this.renderTask;
        }
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
    };

    /**
     * This function will be used when the Ohm64 sends us
     * sysex messages. It should be noted that we receive the
     * codes one at a time so we have to build the entire string
     * and then parse it.
     *
     * ex. 240 0 1 97 2 6 247
     *
     * @param integer code The sysex code
     */ 
    this.parseSysexCode = function (code) {
        if (code == SysexMessage.CODE_MESSAGE_START) {
            // If we are sent a new message, clear the old one
            this.sysexMessageCodes = [];
        }

        this.sysexMessageCodes.push(code);

        if (code == SysexMessage.CODE_MESSAGE_END) {
            var sysexMessage = new SysexMessage(this.sysexMessageCodes);

            if (!sysexMessage.isValid()) {
                error('Invalid Sysex message');
                return;
            }

            // Process the completed sysex message
            if (sysexMessage.operation == SysexMessage.OPERATION_BUTTON_MAP) {
                var midiButtonMap = [];

                var buttonId = 0;
                for (var i = 0; i < sysexMessage.data.length; i++) {
                    // Every other value in the button map data is a place holder.
                    // Only proceess the acutal button data (even index values)
                    if (i % 2) {
                        continue;
                    }

                    midiButtonMap[sysexMessage.data[i]] = buttonId;
                    buttonId++;
                }

                this.midiButtonMap = midiButtonMap;
            }
        }
    };

    /**
     * Retrieve a button object
     * 
     * @param interger midiNote The midi note sent by the button
     * 
     * @returns Ohm64_Button
     */
    this.getButton = function (midiNote) {
        // We cannot return a valid button object if the button map has not been instantiated
        if (this.midiButtonMap === undefined) {
            return null;
        }

        var buttonId = this.midiButtonMap[midiNote];

        if (this.buttonStates[buttonId] === undefined) {
            this.buttonStates[buttonId] = new Ohm64_Button(buttonId, this.viewFunction, this.blinkSpeed);
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
     * Set the blink speed. If a button Id is specified only that button will be
     * updated. Else every button will be updated.
     *
     * @var intger blinkSpeed The blink speed in miliseconds
     * @var integer buttonId The button to update (optional)
     */
     this.setBlinkSpeed = function (blinkSpeed, buttonId) {
        var buttons;

        if (buttonId !== undefined) {
            buttons = [this.getButton(buttonId)];
        } else {
            this.blinkSpeed = blinkSpeed;
            buttons = this.buttonStates;
        }

        for (index in buttons) {
            buttons[index].setBlinkSpeed(blinkSpeed);
        }
     }

    /**
     * Set the state of all the buttons
     *
     * @param array states a list of the states (ON or OFF)
     */
    this.setStatesFromArray = function (states) {
        // Validate the input
        if (states.length !== 64) {
            error('Invalid list. Must be 8x8 list');
            return;
        }
            
        // Update the button states
        for(var i = 0; i < states.length; i++) {
            this.getButton(i).state = Boolean(states[i]);
        }
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
            var button = this.getButton(index);
            var isSet = (index === null || button === null) ? false : button.state;
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
     * Send a message to the Ohm64 to get its MIDI button map
     */
    this.requestMidiButtonMap = function () {
        var getButtonMap = [240, 0, 1, 97, 2, 7, 11, 247];
        this.midiInterface.message(getButtonMap);
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
    };

    /**
     * This array hold the order in which the rows and columns need
     * be added to get the correct LL HH values
     * 
     * @var array
     */
    this.OHM64_INDEX_MASK = [
        [0, 48, 33, 18, 3, 51, 36, 21, 6, 54, null, 39, null, null],
        [8, 56, 41, 26, 11, 59, 44, 29, 14, 62, null, 47, null, null],
        [16, 1, 49, 34, 19, 4, 52, 37, 22, 7, null, 55, null, null],
        [24, 9, 57, 42, 27, 12, 60, 45, 30, 15, null, 63, null, null],
        [32, 17, 2, 50, 35, 20, 5, 53, 38, 23, null, null, null, null],
        [40, 25, 10, 58, 43, 28, 13, 61, 46, 31, null, null, null, null]
    ];

    // Initialize the Ohm64
    this.init();
};

var Ohm64_Button = function (buttonId, viewFunctionName, blinkSpeed) {

    /**
     * Initialize the object
     */
    this.init = function () {    
        this.buttonId = buttonId;
        this.state = BUTTON_OFF;
        this.setViewFunction(viewFunctionName);
        this.isBlinking = false;
        this.setBlinkSpeed(blinkSpeed);
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
        this.state = (this.state == BUTTON_OFF) ? BUTTON_ON : BUTTON_OFF;
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
                },
                this
            );
            this.blinkTask.interval = this.blinkSpeed;
            this.blinkTask.repeat();
            this.isBlinking = true;
        } else {
            this.cancelBlink();
            this.state = BUTTON_OFF;
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

var SysexMessage = function (message) {
    this.messageStart = message.shift();
    this.header1 = message.shift();
    this.header2 = message.shift();
    this.header3 = message.shift();
    this.deviceId = message.shift();
    this.operation = message.shift();
    this.messageEnd = message.pop();
    this.data = message;

    this.isValid = function () {
        return (
            this.messageStart == SysexMessage.CODE_MESSAGE_START &&
            this.header1 == SysexMessage.CODE_MESSAGE_HEADER1 &&
            this.header2 == SysexMessage.CODE_MESSAGE_HEADER2 &&
            this.header3 == SysexMessage.CODE_MESSAGE_HEADER3 &&
            this.deviceId == SysexMessage.CODE_MESSAGE_DEVICE_ID &&
            this.messageEnd == SysexMessage.CODE_MESSAGE_END &&
            this.operation !== undefined
        );
    }
};

SysexMessage.CODE_MESSAGE_START = 240;
SysexMessage.CODE_MESSAGE_END = 247;
SysexMessage.CODE_MESSAGE_HEADER1 = 0;
SysexMessage.CODE_MESSAGE_HEADER2 = 1;
SysexMessage.CODE_MESSAGE_HEADER3 = 97;  
SysexMessage.CODE_MESSAGE_DEVICE_ID = 2;
SysexMessage.OPERATION_ACK = 127;
SysexMessage.OPERATION_BUTTON_MAP = 11;

/*******************************************************************/

var Ohm64_Controller = new Ohm64(this.patcher);

// Here are the available messages this object can receive
function init() {Ohm64_Controller.init();}
function clear() {Ohm64_Controller.clear();}
function setViewFunction(viewFunction) {Ohm64_Controller.setViewFunction(viewFunction); }
function setBlinkSpeed(blinkSpeed, buttonId) {Ohm64_Controller.setBlinkSpeed(blinkSpeed, buttonId);}
function factoryReset() {Ohm64_Controller.factoryReset();}
function list(arguements) {Ohm64_Controller.setStatesFromArray(arrayfromargs(messagename,arguments));}
function button(buttonId, state) {Ohm64_Controller.buttonPress(buttonId, state);}
function sysex(code) {Ohm64_Controller.parseSysexCode(code);}
function renderStart() {Ohm64_Controller.renderStart();}
function renderStop() {Ohm64_Controller.renderStop();}
