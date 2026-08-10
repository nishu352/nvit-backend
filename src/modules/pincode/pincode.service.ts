import { prisma } from "../../config/prisma.js";

export async function checkPincodeServiceability(pincode: string) {
  const records = await prisma.pincodeServiceability.findMany({
    where: { pincode },
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
  });

  if (records.length === 0) {
    return {
      pincode,
      city: "Unknown",
      state: "Unknown",
      area: "Non-indexed Area",
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
      city: r.city,
      state: r.state,
      area: r.area,
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
      city: r.city,
      state: r.state,
      area: r.area,
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
    pincode,
    city: sampleRecord?.city || "Unknown",
    state: sampleRecord?.state || "Unknown",
    area: sampleRecord?.area || "Unknown",
    availableBanks,
    availableNbfcs,
    serviceStatus,
    totalServiceable,
  };
}
