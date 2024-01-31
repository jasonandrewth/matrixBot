const sdk = require("matrix-bot-sdk");
// const base64 = require("node-base64-image");
require("dotenv").config();
const fs = require("fs");
const { writeFile } = require("fs").promises;
const path = require("path");

const MatrixClient = sdk.MatrixClient;
const SimpleFsStorageProvider = sdk.SimpleFsStorageProvider;
const AutojoinRoomsMixin = sdk.AutojoinRoomsMixin;

const storage = new SimpleFsStorageProvider("bot.json");

const client = new MatrixClient(
  process.env.MATRIX_URL,
  process.env.MATRIX_ACCESS_TOKEN,
  storage
);
AutojoinRoomsMixin.setupOnClient(client);

const promptJSON = {
  prompt: {
    3: {
      inputs: {
        seed: 73207829680144,
        steps: 20,
        cfg: 8,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
      class_type: "KSampler",
      _meta: {
        title: "KSampler",
      },
    },
    4: {
      inputs: {
        ckpt_name: "realisticVisionV40_v4NoVAE.safetensors",
      },
      class_type: "CheckpointLoaderSimple",
      _meta: {
        title: "Load Checkpoint",
      },
    },
    5: {
      inputs: {
        width: 512,
        height: 512,
        batch_size: 1,
      },
      class_type: "EmptyLatentImage",
      _meta: {
        title: "Empty Latent Image",
      },
    },
    6: {
      inputs: {
        text: "realistic photography of wet floor in berlin ubahn",
        clip: ["4", 1],
      },
      class_type: "CLIPTextEncode",
      _meta: {
        title: "CLIP Text Encode (Prompt)",
      },
    },
    7: {
      inputs: {
        text: "drawing, painting, sketch, bad quality, low resolution, blurry, NSFW, nude, porn",
        clip: ["4", 1],
      },
      class_type: "CLIPTextEncode",
      _meta: {
        title: "CLIP Text Encode (Prompt)",
      },
    },
    8: {
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
      class_type: "VAEDecode",
      _meta: {
        title: "VAE Decode",
      },
    },
    9: {
      inputs: {
        filename_prefix: "ComfyUI",
        images: ["8", 0],
      },
      class_type: "SaveImage",
      _meta: {
        title: "Save Image",
      },
    },
  },
};

// FETCH IMAGE STUFF
// API endpoint and data to send
// const apiUrl = "http://IP:7861/sdapi/v1/txt2img";

// Set up the request options
// const options = {
//   method: "POST",
//   headers: {
//     "Content-Type": "application/x-www-form-urlencoded",
//   },
//   body: postDataString,
// };

const comfyURL = `${process.env.ENDPOINT}:${process.env.PORT}`;

async function queuePrompt(prompt) {
  const res = await fetch(`${comfyURL}/prompt`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(prompt),
  });

  const json = await res.json();

  if ("error" in json) {
    throw new Error(JSON.stringify(json));
  }

  return json;
}

async function getHistory(promptId) {
  if (!promptId) return;

  try {
    const url = `${comfyURL}/history` + (promptId ? `/${promptId}` : "");
    console.log("history url", url);
    const res = await fetch(url);

    const json = await res.json();

    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }

    // console.log("prompt json in history", promptId, json);

    return json;
  } catch (error) {
    console.log("error in gethistory", error);
  }
}

async function getImage(filename, subfolder, type) {
  try {
    const res = await fetch(
      `${comfyURL}/view?` +
        new URLSearchParams({
          filename,
          subfolder,
          type,
        })
    );
    const blob = await res.blob();
    // console.log("getimage blob: ", res);
    return blob;
  } catch (error) {
    console.log("error in getImage");
    console.error(error);
  }
}

async function getImages(prompt) {
  console.log(prompt);

  const queue = await queuePrompt(prompt);
  const promptId = queue.prompt_id;
  console.log("prompt id", promptId);

  let outputImages = {};

  try {
    const historyRes = await getHistory(promptId);
    const history = historyRes[promptId];

    // console.log("history: ", history);

    // Populate output images
    for (const nodeId of Object.keys(history.outputs)) {
      const nodeOutput = history.outputs[nodeId];
      if (nodeOutput.images) {
        const imagesOutput = [];
        for (const image of nodeOutput.images) {
          const blob = await getImage(
            image.filename,
            image.subfolder,
            image.type
          );
          imagesOutput.push({
            blob,
            image,
          });
        }

        outputImages[nodeId] = imagesOutput;
        return outputImages;
      }
    }
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Retry by calling the function recursively
    return getImages(prompt);
  }

  outputImages = {};
}

async function saveImages(response, outputDir) {
  for (const nodeId of Object.keys(response)) {
    if (!nodeId) break;
    for (const img of response[nodeId]) {
      const arrayBuffer = await img.blob.arrayBuffer();

      //Keep output path the same to replace
      // const outputPath = path.join(outputDir, img.image.filename);
      const outputPath = path.join(outputDir, "currentImage.png");

      // const outputPath = join(outputDir, img.image.filename);
      const imgPosted = await writeFile(outputPath, Buffer.from(arrayBuffer));
      console.log("img posted", imgPosted);
    }
  }
}

const imagePath = "./decodedImage.png";

const uploadMatrix = function (roomId, imageBuffer) {
  if (client) {
    client.sendMessage(roomId, {
      msgtype: "m.notice",
      body: "image coming",
    });

    client
      .uploadContent(imageBuffer, {
        name: "test-image.png",
        type: "image/png",
      })
      .then((response) => {
        console.log("res", response);
        const imageUrl = response;
        console.log("url", imageUrl);

        // Send a message with the image URL
        return client.sendMessage(roomId, {
          body: "New image made!",
          msgtype: "m.image",
          url: imageUrl,
          info: {
            mimetype: "image/png",
            size: imageBuffer.length,
          },
        });
      })
      .then(() => {
        console.log("Image sent successfully");
      })
      .catch((error) => {
        console.error("Error sending image:", error);
      });
    // .finally(() => {
    //   client.stop();
    // });
  } else {
    console.error("No Client");
  }
};

// async function SendRequest(datatosend, roomId) {
//   let data = "";
//   function OnResponse(response) {
//     console.log("response");
//     console.log(response);

//     response.on("data", function (chunk) {
//       data += chunk; //Append each chunk of data received to this variable.
//     });
//     response.on("end", function () {
//       console.log("end");
//       data = data;
//       const base64String = JSON.parse(data).images[0];
//       const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");

//       // Decode the Base64 string into a Buffer
//       const buffer = Buffer.from(base64Data, "base64");

//       // Save the Buffer to a file (optional)
//       fs.writeFileSync("decodedImage.png", buffer);

//       const imageBuffer = fs.readFileSync(imagePath);

//       if (client) {
//         client.sendMessage(roomId, {
//           msgtype: "m.notice",
//           body: "image coming",
//         });

//         client
//           .uploadContent(imageBuffer, {
//             name: "test-image.png",
//             type: "image/png",
//           })
//           .then((response) => {
//             console.log("res", response);
//             const imageUrl = response;
//             console.log("url", imageUrl);

//             // Send a message with the image URL
//             return client.sendMessage(roomId, {
//               body: "Check out this image!",
//               msgtype: "m.image",
//               url: imageUrl,
//               info: {
//                 mimetype: "image/png",
//                 size: buffer.length,
//               },
//             });
//           })
//           .then(() => {
//             console.log("Image sent successfully");
//           })
//           .catch((error) => {
//             console.error("Error sending image:", error);
//           });
//         // .finally(() => {
//         //   client.stop();
//         // });
//       } else {
//         console.error("no client");
//       }

//       return data;
//     });
//   }

//   var request = http.request(urlparams, OnResponse); //Create a request object.

//   request.write(datatosend); //Send off the request.
//   request.end(); //End the request.

//   return data;
// }
// console.log("baser", string);
client.start().then(() => console.log("Client started!"));

//UTIL

function calculateAspectDimensions(x, y, maxSize) {
  const powerOfTwo = (num) => Math.pow(2, Math.ceil(Math.log2(num)));

  // Split the aspect ratio into x and y
  // const [x, y] = aspectRatio.split(":").map(Number);

  console.log("running function", maxSize, x, y);

  const aspectRatio = x / y;
  const exponent = Math.floor(Math.log2(maxSize / aspectRatio));

  const newWidth = Math.pow(2, exponent);
  const newHeight = newWidth / aspectRatio;

  console.log("calc dimensions", newWidth, newHeight);

  return { width: newWidth, height: newHeight };
}

client.on("room.message", async (roomId, event) => {
  if (!event["content"]) return;
  const sender = event["sender"];
  const body = event["content"]["body"];
  // console.log(`${roomId}: ${sender} says '${body}`);

  if (body.startsWith("!echo")) {
    const replyText = body.substring("!echo".length).trim();
    client.sendMessage(roomId, {
      msgtype: "m.notice",
      body: replyText,
    });
  }

  // if (body.startsWith("!image")) {
  //   const replyText = body.substring("!image".length).trim();

  //   const postData = {
  //     prompt:
  //       replyText ??
  //       "realistic black and white photography of a tall man petting a dog",
  //     negative_prompt: "deformed, cartoon",
  //     steps: 5,
  //   };
  //   // Convert the JSON object to a string
  //   const postDataString = JSON.stringify(postData);

  //   SendRequest(postDataString, roomId);

  //   // client.sendMessage(roomId, {
  //   //   msgtype: "m.notice",
  //   //   body: replyText,
  //   // });
  // }

  if (body.startsWith("!photo")) {
    console.log("trying comfy prompt");
    const replyText = body.substring("!image".length).trim();

    const promptJSONcopy = { ...promptJSON };

    // Use a regular expression to match "--param-" followed by one or more digits
    const matchSize = replyText.match(/--size-(\d+)/);
    const matchModel = replyText.match(/-sd(\d+)/);
    const matchOrientation = replyText.match(/--orientation-(\d+)/);
    const matchSeed = replyText.match(/--seed-(\d+)/);
    const matchAspect = replyText.match(/(\d+):(\d+)/);
    // Check if there's a match and extract the number
    const sizeNumber = matchSize ? parseInt(matchSize[1], 10) : null;
    const orientationNumber = matchOrientation
      ? parseInt(matchOrientation[1], 10)
      : null;
    const seed = matchSeed ? parseInt(matchSeed[1], 10) : 5;

    // Set the text prompt for our positive CLIPTextEncode
    promptJSONcopy.prompt["6"].inputs.text =
      `cinematic photo of ${replyText}, photograph, film, best quality, highres` ??
      "Error sign";

    if (!matchModel || matchModel !== "15") {
      promptJSONcopy.prompt["4"].inputs.ckpt_name =
        "juggernautXL_v8Rundiffusion.safetensors";
    }

    // Set dimensions
    if (sizeNumber) {
      console.log("size works", sizeNumber);
      switch (sizeNumber) {
        case 1:
          promptJSONcopy.prompt["5"].inputs.width = 512;
          promptJSONcopy.prompt["5"].inputs.height = 512;
          break;
        case 2:
          promptJSONcopy.prompt["5"].inputs.width = 768;
          promptJSONcopy.prompt["5"].inputs.height = 768;
          break;
        case 3:
          promptJSONcopy.prompt["5"].inputs.width = 1024;
          promptJSONcopy.prompt["5"].inputs.height = 1024;
          break;
        default:
          promptJSONcopy.prompt["5"].inputs.width = 512;
          promptJSONcopy.prompt["5"].inputs.height = 512;
      }
    }
    if (orientationNumber) {
      switch (orientationNumber) {
        case 1:
          break;
        case 2:
          promptJSONcopy.prompt["5"].inputs.width = Math.round(
            promptJSONcopy.prompt["5"].inputs.width * 1.5
          );
          break;
        case 3:
          promptJSONcopy.prompt["5"].inputs.height = Math.round(
            promptJSONcopy.prompt["5"].inputs.height * 1.5
          );
          break;
        default:
          promptJSONcopy.prompt["5"].inputs.width = 512;
          promptJSONcopy.prompt["5"].inputs.height = 512;
      }
    }

    if (matchAspect) {
      console.log("match aspect", matchAspect[0]);
      const [x, y] = matchAspect[0].split(":").map(Number);
      console.log("x,y", x, y);
      const { width, height } = calculateAspectDimensions(
        x,
        y,
        Math.max(
          promptJSONcopy.prompt["5"].inputs.width,
          promptJSONcopy.prompt["5"].inputs.height
        )
      );

      if (width && height) {
        promptJSONcopy.prompt["5"].inputs.width = width;
        promptJSONcopy.prompt["5"].inputs.height = height;
      }
    }

    // Set the seed for our KSampler node
    promptJSONcopy.prompt["3"].inputs.seed = seed;
    console.log("test string: ", promptJSON.prompt["6"].inputs.text);
    const comfyTestBlob = await getImages(promptJSONcopy);
    console.log("comfy", comfyTestBlob);

    const outputDir = "./results/";
    const images = await saveImages(comfyTestBlob, outputDir);
    const imageBuffer = fs.readFileSync("./results/currentImage.png");

    /*
      MOVE THIS IN FUNCTION
    */
    if (client) {
      client.sendMessage(roomId, {
        msgtype: "m.notice",
        body: `image coming: Anfrage ${sender} }`,
      });
    }

    uploadMatrix(roomId, imageBuffer);
  }
});
