import { prisma } from "../../config/prisma.js";

export async function checkPincodeServiceability(pincode: string) {
  const cleanPin = (pincode || "").trim().padStart(6, "0");

  const [records, master] = await Promise.all([
    prisma.pincodeServiceability.findMany({
      where: { pincode: { in: [pincode, cleanPin] } },
      include: {
        bank: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
            logoUrl: true,
          },
        },
      },
    }),
    prisma.pincodeMaster.findUnique({
      where: { pincode: cleanPin },
    }),
  ]);

  const defaultCity = master?.city || master?.district || "Unknown";
  const defaultState = master?.state || "Unknown";
  const defaultArea = master?.primaryOffice || master?.allOffices?.split(",")[0]?.trim() || "Non-indexed Area";

  if (records.length === 0) {
    return {
      pincode: cleanPin,
      city: defaultCity,
      state: defaultState,
      area: defaultArea,
      district: master?.district || null,
      availableBanks: [],
      availableNbfcs: [],
      serviceStatus: "NON_SERVICEABLE",
      totalServiceable: 0,
    };
  }

  const availableBanks = records
    .filter((r: any) => r.bank.type === "BANK")
    .map((r: any) => ({
      bankId: r.bank.id,
      bankName: r.bank.name,
      bankCode: r.bank.code,
      bankType: r.bank.type,
      category: r.category || "REGULAR",
      isServiceable: r.isServiceable,
      isNegative: r.isNegative,
      city: r.city || defaultCity,
      state: r.state || defaultState,
      area: r.area || defaultArea,
    }));

  const availableNbfcs = records
    .filter((r: any) => r.bank.type === "NBFC")
    .map((r: any) => ({
      bankId: r.bank.id,
      bankName: r.bank.name,
      bankCode: r.bank.code,
      bankType: r.bank.type,
      category: r.category || "REGULAR",
      isServiceable: r.isServiceable,
      isNegative: r.isNegative,
      city: r.city || defaultCity,
      state: r.state || defaultState,
      area: r.area || defaultArea,
    }));

  const totalServiceable = records.filter((r: any) => r.isServiceable && !r.isNegative).length;
  let serviceStatus: "FULL_SERVICEABLE" | "PARTIAL_SERVICEABLE" | "NON_SERVICEABLE" = "NON_SERVICEABLE";

  if (totalServiceable >= 4) {
    serviceStatus = "FULL_SERVICEABLE";
  } else if (totalServiceable > 0) {
    serviceStatus = "PARTIAL_SERVICEABLE";
  }

  const sampleRecord = records[0];

  return {
    pincode: cleanPin,
    city: sampleRecord?.city || defaultCity,
    state: sampleRecord?.state || defaultState,
    area: sampleRecord?.area || defaultArea,
    district: master?.district || null,
    availableBanks,
    availableNbfcs,
    serviceStatus,
    totalServiceable,
  };
}
