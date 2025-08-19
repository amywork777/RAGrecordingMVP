import ZeroEntropy from 'zeroentropy';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

async function main(): Promise<void> {
  const apiKey = process.env.ZEROENTROPY_API_KEY;
  if (!apiKey || !apiKey.startsWith('ze_')) {
    console.error('Invalid or missing ZEROENTROPY_API_KEY');
    process.exit(1);
  }

  const client = new ZeroEntropy({ apiKey });
  const collectionName = 'ai-wearable-transcripts';
  const title = 'The Human Microbiome: Structure, Function, and Implications for Health';
  const path = `articles/microbiome-${uuidv4()}.txt`;

  const text = `The Human Microbiome: Structure, Function, and Implications for Health

The human microbiome, defined as the collective genomes of microorganisms residing in and on the human body, represents one of the most complex ecological systems known in biology. It comprises bacteria, archaea, fungi, protozoa, and viruses that collectively influence host physiology, metabolism, immunity, and even neurobiology. This article synthesizes recent findings about the microbiome, emphasizing quantitative facts and mechanistic insights.

Composition and Diversity

The average human harbors approximately 10^14 microbial cells, outnumbering human cells by about 1.3:1.

These organisms collectively encode over 150 times more unique genes than the human genome, dramatically expanding biochemical capacity.

Firmicutes and Bacteroidetes constitute roughly 90% of the gut bacterial community, with Actinobacteria, Proteobacteria, and Verrucomicrobia as notable minorities.

The gut alone contains 500–1000 distinct bacterial species, although individual diversity averages closer to 160 species per person.

Archaeal members, though less abundant, include Methanobrevibacter smithii, which contributes to hydrogen metabolism in the colon.

Viruses in the microbiome, termed the virome, are dominated by bacteriophages, with an estimated 10^9 virus-like particles per gram of feces.

Spatial Organization

Microbial density varies by anatomical niche: the colon contains 10^11 bacteria per gram of luminal content, whereas the stomach averages only 10^3 organisms per milliliter due to acidity.

The oral cavity supports over 700 bacterial taxa, with specialized communities in the tongue dorsum, dental plaque, and gingival crevices.

The skin microbiome is highly heterogeneous: sebaceous sites are enriched in Cutibacterium acnes, while moist sites favor Corynebacterium and Staphylococcus species.

Functional Contributions

The microbiome ferments otherwise indigestible polysaccharides into short-chain fatty acids (SCFAs) such as acetate, propionate, and butyrate, which supply up to 10% of daily caloric requirements.

Butyrate, produced by species like Faecalibacterium prausnitzii, serves as the primary energy source for colonocytes and regulates gene expression via histone deacetylase inhibition.

Microbes synthesize vitamins such as vitamin K2 (menaquinone) and B-group vitamins, including biotin, folate, and riboflavin.

The microbiome modulates bile acid pools, converting primary bile acids into secondary bile acids that influence lipid absorption and signaling through FXR and TGR5 receptors.

Colonization resistance is mediated by competition for nutrients, niche occupation, and direct production of antimicrobial peptides like bacteriocins.

Immune Interactions

Germ-free mice exhibit underdeveloped Peyer’s patches and reduced circulating immunoglobulins, demonstrating microbiota-dependent immune maturation.

Commensals stimulate regulatory T cell differentiation via SCFA signaling, maintaining mucosal immune tolerance.

Specific taxa such as Bacteroides fragilis produce polysaccharide A, which skews T-cell differentiation toward anti-inflammatory phenotypes.

Dysbiosis, defined as disruption in microbial balance, is associated with inflammatory bowel disease (IBD), with decreased abundance of butyrate producers and increased Enterobacteriaceae.

Neurological Implications

The gut–brain axis involves microbial metabolites, vagus nerve signaling, and immune modulation, linking microbiota with mood and cognition.

Tryptophan metabolism by microbes yields indoles that influence serotonin biosynthesis in enterochromaffin cells.

A landmark 2013 study showed that germ-free mice display altered anxiety-like behavior, reversible by colonization with conventional microbiota.

Clinical evidence links reduced Lactobacillus and Bifidobacterium with depression, though causality remains under investigation.

Developmental Dynamics

Neonatal microbiota is shaped by mode of delivery: vaginal birth confers maternal vaginal and fecal microbes, whereas cesarean section enriches skin-associated bacteria.

Breast milk contributes human milk oligosaccharides (HMOs) that selectively promote growth of Bifidobacterium infantis.

By age three, microbial communities resemble the adult state in both taxonomic composition and metabolic function.

Antibiotic exposure during infancy perturbs microbiota assembly, correlating with increased risk of asthma, obesity, and allergies later in life.

Clinical Relevance

Fecal microbiota transplantation (FMT) achieves ~90% efficacy in treating recurrent Clostridioides difficile infection, underscoring therapeutic potential.

Microbiome shifts correlate with type 2 diabetes, including elevated Prevotella copri and reduced Roseburia species.

Obesity is associated with altered Firmicutes/Bacteroidetes ratios and increased capacity for energy harvest from the diet.

Certain microbial metabolites, such as trimethylamine N-oxide (TMAO) derived from choline metabolism, have been implicated in atherosclerosis risk.

Cancer immunotherapy efficacy, particularly with PD-1 checkpoint inhibitors, has been linked to gut microbial diversity and abundance of Akkermansia muciniphila.

Probiotic interventions demonstrate mixed results, often strain-specific, with Lactobacillus rhamnosus GG being among the most studied.

Emerging Technologies

Metagenomic sequencing has replaced culture-dependent methods, revealing that up to 70% of gut microbes are unculturable by conventional means.

Metabolomics allows identification of thousands of small molecules produced by the microbiome, many with unknown functions.

Synthetic biology approaches aim to engineer probiotic strains capable of delivering therapeutic payloads, such as anti-inflammatory cytokines or metabolic regulators.

CRISPR-Cas systems, naturally present in many gut bacteria, are being harnessed for precision editing of microbiomes in situ.

Conclusion

The human microbiome is a dynamic and multifaceted organ-like system, integral to digestion, immunity, metabolism, and neurobiology. With over 10^13 microbial inhabitants, 3 million genes, and hundreds of metabolic pathways, it exerts profound influence on human health. Continued integration of multi-omics, computational modeling, and clinical intervention studies will deepen understanding and enable therapeutic manipulation of microbial communities. Far from being passive symbionts, these microbes represent an extension of human biology itself.`;

  const metadata = {
    title,
    topic: 'microbiome',
    category: 'essay',
    source: 'manual-ingest',
    timestamp: new Date().toISOString(),
  } as Record<string, string>;

  console.log(`Adding essay to collection "${collectionName}" at path "${path}"...`);
  await client.documents.add({
    collection_name: collectionName,
    path,
    content: { type: 'text', text },
    metadata,
    overwrite: false,
  });

  console.log('✅ Essay added to ZeroEntropy. Verifying index status...');
  try {
    const info = await client.documents.getInfo({
      collection_name: collectionName,
      path,
      include_content: false,
    });
    console.log(`Index status: ${(info as any).document?.index_status || (info as any).index_status || 'unknown'}`);
  } catch (e: any) {
    console.warn('Verification failed:', e?.message || e);
  }
}

main().catch((err: any) => {
  console.error('Failed to add essay:', err?.message || err);
  process.exit(1);
});


