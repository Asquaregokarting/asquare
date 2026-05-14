import { addDoc, collection } from "firebase/firestore";
import { initializeFirestore } from "../lib/firebase";
import { getFirestoreSessionUser, isPrivilegedRole } from "./firestore-session";
import { nowIso } from "./firestore-utils";
import { listFirestoreActivityHierarchy, replaceFirestoreLocationHierarchy } from "./activities-firestore";
import type { ParsedVendor, ParsedGame } from "./vendor-game-import";
import type { BranchLocationKey } from "./types";

const VENDOR_DETAILS_COLLECTION = "vendorDetails";

export interface ImportResult {
  vendorsCreated: number;
  gamesCreated: number;
  errors: Array<{ sheet: "Vendors" | "Games"; row: number; message: string }>;
}

/**
 * Import vendors and games from parsed Excel data into Firestore.
 * Phase 1: Create vendorDetails documents.
 * Phase 2: Merge games into existing location hierarchies.
 */
export const importVendorsAndGames = async (
  token: string,
  vendors: Array<{ rowNumber: number; vendor: ParsedVendor }>,
  games: Array<{ rowNumber: number; game: ParsedGame }>,
  onProgress?: (message: string) => void
): Promise<ImportResult> => {
  const sessionUser = await getFirestoreSessionUser(token);
  if (!isPrivilegedRole(sessionUser.role)) {
    throw new Error("Only Owner or Admin can perform bulk imports.");
  }

  const firestore = initializeFirestore();
  if (!firestore) throw new Error("Firestore is not configured.");

  const result: ImportResult = { vendorsCreated: 0, gamesCreated: 0, errors: [] };
  const vendorNameToDocId = new Map<string, string>();

  // ── Phase 1: Import Vendors ──
  onProgress?.("Creating vendor records...");
  for (const { rowNumber, vendor } of vendors) {
    try {
      const timestamp = nowIso();
      const docRef = await addDoc(collection(firestore, VENDOR_DETAILS_COLLECTION), {
        vendorName: vendor.vendorName,
        userName: vendor.vendorName,
        userEmail: vendor.email,
        particular: vendor.companyName,
        mobileNumber: vendor.mobileNumber,
        email: vendor.email,
        preferredActivity: "Third Party Partner",
        priceInclusiveGst: 0,
        revenueShare: vendor.revenueShare,
        vendorType: vendor.vendorType,
        address: vendor.address,
        bankAccountNumber: vendor.bankAccountNumber,
        bankName: vendor.bankName,
        ifscCode: vendor.ifscCode,
        branch: vendor.bankBranch,
        gstNumber: vendor.gstNumber,
        branchId: vendor.branchId,
        branchName: vendor.branchName,
        submittedAt: timestamp,
        updatedAt: timestamp,
        status: "Submitted",
        importedBy: sessionUser.id,
        importedAt: timestamp,
      });

      vendorNameToDocId.set(vendor.vendorName.toLowerCase(), docRef.id);
      result.vendorsCreated++;
    } catch (err) {
      result.errors.push({
        sheet: "Vendors",
        row: rowNumber,
        message: err instanceof Error ? err.message : "Failed to create vendor",
      });
    }
  }

  // ── Phase 2: Import Games ──
  if (games.length === 0) return result;

  onProgress?.("Building game hierarchies...");

  // Group games by branch
  const gamesByBranch = new Map<BranchLocationKey, Array<{ rowNumber: number; game: ParsedGame }>>();
  for (const entry of games) {
    const branch = entry.game.branch;
    if (!gamesByBranch.has(branch)) gamesByBranch.set(branch, []);
    gamesByBranch.get(branch)!.push(entry);
  }

  // Fetch existing hierarchies for affected branches
  const existingLocations = await listFirestoreActivityHierarchy();
  const existingByKey = new Map(existingLocations.map((loc) => [loc.id, loc]));

  for (const [branchKey, branchGames] of gamesByBranch) {
    onProgress?.(`Processing games for branch ${branchKey}...`);

    // Build the new games to merge
    const newGamesMap = new Map<string, {
      name: string;
      status: "Active" | "Inactive";
      metadata: Record<string, unknown>;
      subGames: Map<string, {
        name: string;
        variants: Array<{
          label: string;
          price: number;
          durationMinutes?: number;
          laps?: number;
          active: boolean;
          metadata?: Record<string, unknown>;
        }>;
      }>;
    }>();

    for (const { rowNumber: _rowNumber, game } of branchGames) {
      const vendorDocId = vendorNameToDocId.get(game.vendorName.toLowerCase());

      const gameKey = game.gameName.toLowerCase();
      if (!newGamesMap.has(gameKey)) {
        newGamesMap.set(gameKey, {
          name: game.gameName,
          status: game.gameStatus,
          metadata: vendorDocId ? { vendorId: vendorDocId, vendorUserId: vendorDocId } : {},
          subGames: new Map(),
        });
      }

      const gameEntry = newGamesMap.get(gameKey)!;
      const subKey = game.subGameName.toLowerCase();
      if (!gameEntry.subGames.has(subKey)) {
        gameEntry.subGames.set(subKey, { name: game.subGameName, variants: [] });
      }

      gameEntry.subGames.get(subKey)!.variants.push({
        label: game.variantLabel,
        price: game.price,
        durationMinutes: game.durationMinutes,
        laps: game.laps,
        active: game.active,
      });

      result.gamesCreated++;
    }

    // Merge with existing hierarchy
    const existing = existingByKey.get(branchKey);
    const existingGames = existing?.games ?? [];

    // Convert existing games to the payload format
    const mergedGames: Array<{
      name: string;
      imageUrl?: string;
      status: "Active" | "Inactive";
      metadata?: Record<string, unknown>;
      subGames: Array<{
        name: string;
        metadata?: Record<string, unknown>;
        variants: Array<{
          label: string;
          price: number;
          durationMinutes?: number;
          laps?: number;
          active: boolean;
          metadata?: Record<string, unknown>;
        }>;
      }>;
    }> = [];

    // Keep all existing games
    for (const existingGame of existingGames) {
      mergedGames.push({
        name: existingGame.name,
        imageUrl: existingGame.imageUrl,
        status: existingGame.status,
        metadata: existingGame.metadata,
        subGames: existingGame.subGames.map((sg) => ({
          name: sg.name,
          metadata: sg.metadata,
          variants: sg.variants.map((v) => ({
            label: v.label,
            price: v.price,
            durationMinutes: v.durationMinutes,
            laps: v.laps,
            active: v.active,
            metadata: v.metadata,
          })),
        })),
      });
    }

    // Add new games (merge if game name already exists)
    for (const [, newGame] of newGamesMap) {
      const existingIdx = mergedGames.findIndex(
        (g) => g.name.toLowerCase() === newGame.name.toLowerCase()
      );

      const newSubGames = Array.from(newGame.subGames.values()).map((sg) => ({
        name: sg.name,
        variants: sg.variants,
      }));

      if (existingIdx >= 0) {
        // Merge subgames into existing game
        const existingMerged = mergedGames[existingIdx];
        for (const newSg of newSubGames) {
          const existingSgIdx = existingMerged.subGames.findIndex(
            (sg) => sg.name.toLowerCase() === newSg.name.toLowerCase()
          );
          if (existingSgIdx >= 0) {
            // Merge variants into existing subgame
            for (const newVariant of newSg.variants) {
              const existsVariant = existingMerged.subGames[existingSgIdx].variants.some(
                (v) => v.label.toLowerCase() === newVariant.label.toLowerCase()
              );
              if (!existsVariant) {
                existingMerged.subGames[existingSgIdx].variants.push(newVariant);
              }
            }
          } else {
            existingMerged.subGames.push(newSg);
          }
        }
        // Update metadata with vendor info if not already set
        if (newGame.metadata.vendorId && !existingMerged.metadata?.vendorId) {
          existingMerged.metadata = { ...existingMerged.metadata, ...newGame.metadata };
        }
      } else {
        // Add as new game
        mergedGames.push({
          name: newGame.name,
          status: newGame.status,
          metadata: newGame.metadata,
          subGames: newSubGames,
        });
      }
    }

    // Save the merged hierarchy
    try {
      await replaceFirestoreLocationHierarchy(token, {
        locationKey: branchKey,
        games: mergedGames,
      });
    } catch (err) {
      // Mark all games for this branch as failed
      for (const { rowNumber } of branchGames) {
        result.errors.push({
          sheet: "Games",
          row: rowNumber,
          message: err instanceof Error ? err.message : `Failed to save games for branch ${branchKey}`,
        });
      }
      // Subtract the count we already added
      result.gamesCreated -= branchGames.length;
    }
  }

  return result;
};
