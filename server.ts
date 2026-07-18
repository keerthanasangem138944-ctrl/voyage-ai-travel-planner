import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Initialize GoogleGenAI SDK server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Endpoint to suggest destinations based on user profile
app.post("/api/recommend-destinations", async (req, res) => {
  try {
    const {
      departureCity,
      numberOfDays,
      budget,
      currency,
      travelStyle,
      monthOfTravel,
      interests,
      accommodationPreference,
      transportationPreference,
      foodPreference,
      accessibilityRequirements,
      specialRequests,
    } = req.body;

    const prompt = `
      You are VoyageAI, an award-winning travel consultant.
      The user wants destination suggestions based on the following profile:
      - Departure City: ${departureCity || "Anywhere"}
      - Duration: ${numberOfDays || "flexible"} days
      - Budget: ${budget || "flexible"} ${currency || "USD"}
      - Travel Style: ${travelStyle || "any style"}
      - Month of Travel: ${monthOfTravel || "any month"}
      - Interests: ${interests ? interests.join(", ") : "general sightseeing"}
      - Accommodation Preference: ${accommodationPreference || "any"}
      - Transportation Preference: ${transportationPreference || "any"}
      - Food Preference: ${foodPreference || "any"}
      - Mobility/Accessibility: ${accessibilityRequirements || "none"}
      - Special Requests: ${specialRequests || "none"}

      Recommend exactly 5 distinct destinations. Rank them based on:
      - Budget compatibility
      - Weather during ${monthOfTravel || "travel period"}
      - Match with user interests (${interests ? interests.join(", ") : "general"})
      - Travel Duration (${numberOfDays} days)
      - Popularity, Safety, and Seasonal Suitability

      For each recommendation, explain deeply and clearly why it matches this specific user.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              destination: { type: Type.STRING, description: "City and Country name" },
              whyItMatches: { type: Type.STRING, description: "Clear explanation of why it is a perfect match for their interests and budget" },
              budgetCategory: { type: Type.STRING, description: "Budget vibe (e.g., Ultra-budget, Budget, Mid-range, Premium, Luxury)" },
              weatherBrief: { type: Type.STRING, description: "Brief description of the weather in the travel month" },
              safetyRating: { type: Type.STRING, description: "Safety brief/rating (e.g., Safe, Very Safe, Normal Precautions)" },
              popularity: { type: Type.STRING, description: "Popularity level" },
              estimatedCost: { type: Type.STRING, description: "Estimated total cost range in the user's currency" },
            },
            required: ["destination", "whyItMatches", "budgetCategory", "weatherBrief", "safetyRating", "popularity", "estimatedCost"],
          },
        },
      },
    });

    const jsonText = response.text || "[]";
    const recommendations = JSON.parse(jsonText.trim());
    res.json({ recommendations });
  } catch (error: any) {
    console.error("Error recommending destinations:", error);
    res.status(500).json({ error: error.message || "Failed to recommend destinations" });
  }
});

// Endpoint to generate full voyage plan
app.post("/api/generate-itinerary", async (req, res) => {
  try {
    const {
      departureCity,
      destination,
      numberOfDays,
      numberOfTravelers,
      budget,
      currency,
      travelStyle,
      monthOfTravel,
      interests,
      accommodationPreference,
      transportationPreference,
      foodPreference,
      accessibilityRequirements,
      specialRequests,
    } = req.body;

    if (!destination) {
      return res.status(400).json({ error: "Destination is required to generate an itinerary" });
    }

    const duration = Math.min(Math.max(Number(numberOfDays) || 3, 1), 7); // lock to 1-7 days to prevent timeouts and optimize content density

    const prompt = `
      You are VoyageAI, an award-winning travel consultant.
      Generate a hyper-personalized, ultra-detailed, realistic travel itinerary and optimization plan for:
      
      - Destination: ${destination}
      - Departure City: ${departureCity || "Anywhere"}
      - Travel Month: ${monthOfTravel || "Any month"}
      - Duration: ${duration} Days
      - Number of Travelers: ${numberOfTravelers || 1}
      - Total Budget: ${budget || "reasonable"} ${currency || "USD"}
      - Travel Style: ${travelStyle || "balanced"}
      - Interests: ${interests ? interests.join(", ") : "local highlights, culture, food"}
      - Accommodation Preference: ${accommodationPreference || "comfortable"}
      - Transportation Preference: ${transportationPreference || "public transit/walking"}
      - Food Preference: ${foodPreference || "local street food and high-rated spots"}
      - Accessibility Requirements: ${accessibilityRequirements || "none"}
      - Special Requests/Constraints: ${specialRequests || "none"}

      Quality Constraints:
      - Never hallucinate names or invent impossible values. Use highly realistic pricing estimates in ${currency || "USD"}.
      - Day-by-day routing must be geographically logical. Group nearby attractions together and reduce transport overhead.
      - Each day must contain explicit activities for Morning, Afternoon, Evening, and Night with realistic timings, travel times, expected durations, estimated costs, tipping/local advice, nearby restaurants, and specific photography tips.
      - Hotel recommendations must feature realistic mid-range, budget, and luxury options matching the local vibe of ${destination}.
      - Budget Table must provide specific allocations summing to a realistic estimation near the budget limits, with actionable Budget Saving Tips and Luxury Upgrade suggestions.
      - Local Guide must include real-time customs, local phrases with translations, public transport tips, currency specifics, payment modes (e.g. cash vs cards), and safety warnings (scams, locations to avoid).
      - Packing Checklist must align precisely with the month (${monthOfTravel}) and expected weather at ${destination}.
      - Include Hidden Gems (scenic, local markets, sunrise/sunset, photo spots).
      - Include Optional Experiences.
      - Create resilient Alternative Plans (such as: what to do if rain happens, if budget gets suddenly squeezed, or if a primary attraction is closed).
    `;

    // Detailed structured schema to enforce complete compliance with all VoyageAI instructions
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        destinationSummary: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            brief: { type: Type.STRING, description: "A highly engaging overview of the destination and what makes it special" },
            bestFeatures: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3 key features that match the traveler style" }
          },
          required: ["name", "brief", "bestFeatures"]
        },
        budgetSummary: {
          type: Type.OBJECT,
          properties: {
            totalEstimate: { type: Type.NUMBER, description: "Total realistic estimated cost" },
            savingTips: { type: Type.ARRAY, items: { type: Type.STRING } },
            luxuryUpgrades: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["totalEstimate", "savingTips", "luxuryUpgrades"]
        },
        budgetBreakdown: {
          type: Type.OBJECT,
          properties: {
            flights: { type: Type.NUMBER, description: "Estimate for flights/travel to destination" },
            hotels: { type: Type.NUMBER, description: "Estimate for accommodation" },
            transport: { type: Type.NUMBER, description: "Estimate for local transport" },
            food: { type: Type.NUMBER, description: "Estimate for dining" },
            activities: { type: Type.NUMBER, description: "Estimate for entrance fees, tours" },
            shopping: { type: Type.NUMBER, description: "Estimate for souvenirs/retail" },
            emergencyFund: { type: Type.NUMBER, description: "Emergency cash allocation" },
            taxes: { type: Type.NUMBER, description: "Taxes/Fees estimate" },
            miscellaneous: { type: Type.NUMBER, description: "Other expenses" }
          },
          required: [
            "flights", "hotels", "transport", "food", "activities",
            "shopping", "emergencyFund", "taxes", "miscellaneous"
          ]
        },
        days: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              dayNumber: { type: Type.INTEGER },
              theme: { type: Type.STRING, description: "Focus/theme of this specific day (e.g. Historic Heart, Coastal Adventure)" },
              morning: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING, description: "e.g. 08:30 AM" },
                  activity: { type: Type.STRING, description: "Detailed description of activity" },
                  travelDuration: { type: Type.STRING, description: "Time/method to get there from previous/hotel" },
                  estimatedCost: { type: Type.STRING, description: "e.g. $15 or Free" },
                  expectedDuration: { type: Type.STRING, description: "e.g. 2.5 hours" },
                  tips: { type: Type.STRING, description: "Insider tip, dress codes, or booking advice" },
                  nearbyAttractions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  nearbyRestaurants: { type: Type.ARRAY, items: { type: Type.STRING } },
                  photoOpportunities: { type: Type.STRING, description: "Best spots or times for photos" }
                },
                required: ["time", "activity", "travelDuration", "estimatedCost", "expectedDuration", "tips", "nearbyAttractions", "nearbyRestaurants", "photoOpportunities"]
              },
              afternoon: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  activity: { type: Type.STRING },
                  travelDuration: { type: Type.STRING },
                  estimatedCost: { type: Type.STRING },
                  expectedDuration: { type: Type.STRING },
                  tips: { type: Type.STRING },
                  nearbyAttractions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  nearbyRestaurants: { type: Type.ARRAY, items: { type: Type.STRING } },
                  photoOpportunities: { type: Type.STRING }
                },
                required: ["time", "activity", "travelDuration", "estimatedCost", "expectedDuration", "tips", "nearbyAttractions", "nearbyRestaurants", "photoOpportunities"]
              },
              evening: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  activity: { type: Type.STRING },
                  travelDuration: { type: Type.STRING },
                  estimatedCost: { type: Type.STRING },
                  expectedDuration: { type: Type.STRING },
                  tips: { type: Type.STRING },
                  nearbyAttractions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  nearbyRestaurants: { type: Type.ARRAY, items: { type: Type.STRING } },
                  photoOpportunities: { type: Type.STRING }
                },
                required: ["time", "activity", "travelDuration", "estimatedCost", "expectedDuration", "tips", "nearbyAttractions", "nearbyRestaurants", "photoOpportunities"]
              },
              night: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  activity: { type: Type.STRING },
                  travelDuration: { type: Type.STRING },
                  estimatedCost: { type: Type.STRING },
                  expectedDuration: { type: Type.STRING },
                  tips: { type: Type.STRING },
                  nearbyAttractions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  nearbyRestaurants: { type: Type.ARRAY, items: { type: Type.STRING } },
                  photoOpportunities: { type: Type.STRING }
                },
                required: ["time", "activity", "travelDuration", "estimatedCost", "expectedDuration", "tips", "nearbyAttractions", "nearbyRestaurants", "photoOpportunities"]
              }
            },
            required: ["dayNumber", "theme", "morning", "afternoon", "evening", "night"]
          }
        },
        hotels: {
          type: Type.OBJECT,
          properties: {
            budget: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                price: { type: Type.STRING },
                location: { type: Type.STRING },
                pros: { type: Type.ARRAY, items: { type: Type.STRING } },
                bestFor: { type: Type.STRING }
              },
              required: ["name", "price", "location", "pros", "bestFor"]
            },
            midRange: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                price: { type: Type.STRING },
                location: { type: Type.STRING },
                pros: { type: Type.ARRAY, items: { type: Type.STRING } },
                bestFor: { type: Type.STRING }
              },
              required: ["name", "price", "location", "pros", "bestFor"]
            },
            luxury: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                price: { type: Type.STRING },
                location: { type: Type.STRING },
                pros: { type: Type.ARRAY, items: { type: Type.STRING } },
                bestFor: { type: Type.STRING }
              },
              required: ["name", "price", "location", "pros", "bestFor"]
            }
          },
          required: ["budget", "midRange", "luxury"]
        },
        transportation: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              mode: { type: Type.STRING, description: "e.g., Train, Taxi, Walking, Metro" },
              cost: { type: Type.STRING },
              travelTime: { type: Type.STRING },
              convenience: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["mode", "cost", "travelTime", "convenience", "description"]
          }
        },
        foodGuide: {
          type: Type.OBJECT,
          properties: {
            breakfast: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Traditional breakfast highlights" },
            lunch: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Lunch recommendations" },
            dinner: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Dinner highlights" },
            streetFood: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Famous street foods" },
            desserts: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Local sweets" },
            vegetarianOptions: { type: Type.ARRAY, items: { type: Type.STRING } },
            veganOptions: { type: Type.ARRAY, items: { type: Type.STRING } },
            mustTryDishes: { type: Type.ARRAY, items: { type: Type.STRING } },
            famousRestaurants: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific highly-rated real eateries" }
          },
          required: ["breakfast", "lunch", "dinner", "streetFood", "desserts", "vegetarianOptions", "veganOptions", "mustTryDishes", "famousRestaurants"]
        },
        packingChecklist: {
          type: Type.OBJECT,
          properties: {
            documents: { type: Type.ARRAY, items: { type: Type.STRING } },
            electronics: { type: Type.ARRAY, items: { type: Type.STRING } },
            clothing: { type: Type.ARRAY, items: { type: Type.STRING } },
            footwear: { type: Type.ARRAY, items: { type: Type.STRING } },
            medicines: { type: Type.ARRAY, items: { type: Type.STRING } },
            accessories: { type: Type.ARRAY, items: { type: Type.STRING } },
            emergencyItems: { type: Type.ARRAY, items: { type: Type.STRING } },
            toiletries: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["documents", "electronics", "clothing", "footwear", "medicines", "accessories", "emergencyItems", "toiletries"]
        },
        weather: {
          type: Type.OBJECT,
          properties: {
            expectedWeather: { type: Type.STRING },
            temperature: { type: Type.STRING },
            rainProbability: { type: Type.STRING },
            humidity: { type: Type.STRING },
            recommendedClothing: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["expectedWeather", "temperature", "rainProbability", "humidity", "recommendedClothing"]
        },
        localTips: {
          type: Type.OBJECT,
          properties: {
            customsEtiquette: { type: Type.ARRAY, items: { type: Type.STRING } },
            usefulPhrases: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  phrase: { type: Type.STRING },
                  translation: { type: Type.STRING },
                  usage: { type: Type.STRING }
                },
                required: ["phrase", "translation", "usage"]
              }
            },
            currency: { type: Type.STRING },
            paymentMethods: { type: Type.STRING, description: "e.g. Cash vs Card status, credit card acceptance" },
            simCardAdvice: { type: Type.STRING },
            publicTransportTips: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["customsEtiquette", "usefulPhrases", "currency", "paymentMethods", "simCardAdvice", "publicTransportTips"]
        },
        safety: {
          type: Type.OBJECT,
          properties: {
            scams: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific local scams to watch out for" },
            areasToAvoid: { type: Type.ARRAY, items: { type: Type.STRING } },
            hospitals: { type: Type.ARRAY, items: { type: Type.STRING } },
            travelInsuranceAdvice: { type: Type.STRING },
            foodSafetyTips: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["scams", "areasToAvoid", "hospitals", "travelInsuranceAdvice", "foodSafetyTips"]
        },
        hiddenGems: {
          type: Type.OBJECT,
          properties: {
            attractions: { type: Type.ARRAY, items: { type: Type.STRING } },
            localMarkets: { type: Type.ARRAY, items: { type: Type.STRING } },
            sunriseSunsetSpots: { type: Type.ARRAY, items: { type: Type.STRING } },
            photographySpots: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["attractions", "localMarkets", "sunriseSunsetSpots", "photographySpots"]
        },
        optionalExperiences: {
          type: Type.OBJECT,
          properties: {
            adventure: { type: Type.ARRAY, items: { type: Type.STRING } },
            nightlife: { type: Type.ARRAY, items: { type: Type.STRING } },
            shopping: { type: Type.ARRAY, items: { type: Type.STRING } },
            museums: { type: Type.ARRAY, items: { type: Type.STRING } },
            nature: { type: Type.ARRAY, items: { type: Type.STRING } },
            family: { type: Type.ARRAY, items: { type: Type.STRING } },
            luxury: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["adventure", "nightlife", "shopping", "museums", "nature", "family", "luxury"]
        },
        alternativePlans: {
          type: Type.OBJECT,
          properties: {
            ifRain: { type: Type.STRING, description: "Complete alternative day/activities if it rains heavily" },
            ifBudgetChange: { type: Type.STRING, description: "How to adapt if their budget is squeezed by 40%" },
            ifClosure: { type: Type.STRING, description: "Alternative if a main landmark is closed unexpectedly" }
          },
          required: ["ifRain", "ifBudgetChange", "ifClosure"]
        },
        emergencyInformation: {
          type: Type.OBJECT,
          properties: {
            numbers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Police, Medical, Fire, Embassy contacts" },
            hospitals: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["numbers", "hospitals"]
        }
      },
      required: [
        "destinationSummary", "budgetSummary", "budgetBreakdown", "days", "hotels",
        "transportation", "foodGuide", "packingChecklist", "weather", "localTips",
        "safety", "hiddenGems", "optionalExperiences", "alternativePlans", "emergencyInformation"
      ]
    };

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    });

    const planText = response.text || "{}";
    const plan = JSON.parse(planText.trim());
    res.json({ plan });
  } catch (error: any) {
    console.error("Error generating itinerary:", error);
    res.status(500).json({ error: error.message || "Failed to generate travel plan" });
  }
});

// Setup dev vs production client routing
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development server with Vite middleware mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`VoyageAI Server is running on http://localhost:${PORT}`);
  });
}

startServer();
